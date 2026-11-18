package expo.modules.talasync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.random.Random

internal class SyncService private constructor(private val context: Context) {
    private val cipher = DeviceCipher()
    val store = SyncStorage(context, cipher)
    val session = EncoderSession(syncHttpClient(), AndroidCredentialVault(context, cipher))

    fun overview(): JSONObject {
        val account = session.current()
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val network = manager.getNetworkCapabilities(manager.activeNetwork)
        val connected = network?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true &&
            network.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        return JSONObject().put("account", account?.publicJson()).put("connected", connected)
            .put("jobs", if (account == null) JSONArray() else store.list(account))
    }

    fun reconcile() {
        val account = session.current()?.takeIf { it.refresh != null } ?: return
        requeueAuthenticationBlocks(account)
        for (job in store.addresses()) {
            if (job.owner == account.id && job.endpoint == account.endpoint) schedule(job.id)
        }
    }

    fun login(endpoint: String, email: String, password: String) {
        session.login(endpoint, email, password)
        reconcile()
    }

    private fun requeueAuthenticationBlocks(account: Encoder) {
        val jobs = store.list(account, LocalState.SYNC_BLOCKED).objects()
        for (summary in jobs) {
            if (summary.optString("state") != LocalState.SYNC_BLOCKED.name || summary.optString("issueCode") != "AUTH_REQUIRED") continue
            val id = summary.getString("clientSubmissionId")
            val progress = store.latest(id) ?: continue
            if (progress.state != LocalState.SYNC_BLOCKED || progress.issueCode != "AUTH_REQUIRED") continue
            val requeued = store.save(JobAddress(id, account.id, account.endpoint),
                progress.copy(state = LocalState.QUEUED, issueCode = null, issueText = null), previous = LocalState.SYNC_BLOCKED)
            if (requeued) schedule(id, explicit = true)
        }
    }

    fun enqueue(raw: String, owner: String, endpoint: String) {
        val account = session.current() ?: throw signInRequired()
        if (owner != account.id || endpoint != account.endpoint) throw signInRequired()
        val address = store.enqueue(account, JSONObject(raw))
        val saved = store.latest(address.id)
        if (saved?.state == LocalState.QUEUED || saved?.state == LocalState.SYNCING) schedule(address.id, waitForCommit = true)
    }

    fun retry(id: String) {
        val job = ownedJob(id)
        if (job.progress.state != LocalState.SYNC_FAILED) return
        val requeued = store.save(job.address, job.progress.copy(state = LocalState.QUEUED, retries = 0, issueCode = null, issueText = null),
            previous = LocalState.SYNC_FAILED)
        if (requeued) schedule(id, explicit = true, waitForCommit = true)
    }

    fun refreshStatus(id: String) {
        val job = ownedJob(id)
        val serverId = job.progress.serverId
        if (job.progress.state != LocalState.SYNCED || serverId == null) return
        val remote = session.remote(job.address.owner, job.address.endpoint)
        val current = SyncProtocol(remote).applyStatus(job.snapshot, job.progress, remote.status(serverId))
        val latest = store.latest(id)
        if (latest != null && latest.revision <= current.revision) store.save(job.address, current)
    }

    private fun ownedJob(id: String): StoredJob {
        val account = session.current() ?: throw signInRequired()
        val job = store.load(id)
        if (job == null || job.address.owner != account.id || job.address.endpoint != account.endpoint) throw signInRequired()
        return job
    }

    private fun schedule(id: String, explicit: Boolean = false, waitForCommit: Boolean = false) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>().setInputData(workDataOf("id" to id))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        val policy = if (explicit) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP
        val operation = WorkManager.getInstance(context).enqueueUniqueWork("tala.upload.$id", policy, request)
        if (waitForCommit) try { operation.result.get(10, TimeUnit.SECONDS) }
        catch (_: Exception) {
            throw SyncIssue("WORK_SAVED", "This submission is saved in the queue. Reopen the app to restart scheduling.")
        }
    }

    companion object {
        @Volatile private var instance: SyncService? = null
        fun get(context: Context): SyncService = instance ?: synchronized(this) {
            instance ?: SyncService(context.applicationContext).also { instance = it }
        }
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    private val scope = CallScope()

    override fun onStopped() { scope.cancel() }

    override fun doWork(): Result {
        val id = inputData.getString("id") ?: return Result.success()
        val service = SyncService.get(applicationContext)
        return try {
            val job = service.store.load(id) ?: return Result.success()
            if (job.progress.state !in setOf(LocalState.QUEUED, LocalState.SYNCING)) return Result.success()
            if (job.progress.retryAt > System.currentTimeMillis()) return Result.retry()
            transfer(service, job)
        } catch (_: Exception) {
            // A full or unavailable database keeps the last committed checkpoint available for recovery.
            if (runAttemptCount < 6) Result.retry() else Result.failure()
        }
    }

    private fun transfer(service: SyncService, job: StoredJob): Result {
        val address = job.address
        var current = job.progress
        fun checkpoint(next: Progress) {
            service.store.save(address, next)
            current = next
        }
        checkpoint(current.copy(state = LocalState.SYNCING, lastAttempt = System.currentTimeMillis(), issueCode = null, issueText = null))
        val remote = service.session.remote(address.owner, address.endpoint, scope)
        try {
            SyncProtocol(remote).transfer(job.snapshot, current, { service.store.loadPage(address, it) }, ::checkpoint)
        } catch (error: Exception) {
            if (error is android.database.sqlite.SQLiteException) throw error
            val issue = when (error) {
                is SyncIssue -> error
                is org.json.JSONException, is IllegalArgumentException ->
                    SyncIssue("INVALID_RESPONSE", "The API returned an inconsistent result. Open synchronization to check this draft.")
                else -> storageIssue()
            }
            if (current.state == LocalState.SYNCED) return Result.success()
            if (isStopped) {
                checkpoint(current.copy(state = LocalState.QUEUED))
                return Result.retry()
            }
            val retries = current.retries + if (issue.temporary) 1 else 0
            val state = when {
                issue.code == "LOCAL_STORAGE" || issue.code == "TLS_REQUIRED" -> LocalState.SYNC_FAILED
                !issue.temporary -> LocalState.SYNC_BLOCKED
                retries >= 6 -> LocalState.SYNC_FAILED
                else -> LocalState.QUEUED
            }
            val delay = if (issue.temporary) retryDeadline(issue, retries - 1, System.currentTimeMillis(), Random.nextLong(0, 6_000)) else 0
            checkpoint(current.copy(state = state, issueCode = issue.code, issueText = issue.detail, retries = retries, retryAt = delay))
            if (state == LocalState.QUEUED) return Result.retry()
        }
        return Result.success()
    }
}

class SyncBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        val pending = goAsync()
        thread(name = "tala-restore-uploads") {
            try { SyncService.get(context).reconcile() }
            catch (_: Exception) { /* The next app launch will reconcile the saved jobs again. */ }
            finally { pending.finish() }
        }
    }
}
