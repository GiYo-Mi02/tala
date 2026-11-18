package expo.modules.talasync

import org.json.JSONObject
import java.io.File

private class HostVault(private val file: File) : CredentialVault {
    override fun read() = file.takeIf(File::isFile)?.readText()?.let { Encoder.parse(JSONObject(it)) }
    override fun write(encoder: Encoder?) {
        if (encoder == null) file.delete() else file.writeText(encoder.json().toString())
    }
}

private fun expectIssue(code: String, run: () -> Unit): SyncIssue {
    try { run() } catch (issue: SyncIssue) {
        check(issue.code == code) { "Expected $code, received ${issue.code}" }
        return issue
    }
    error("Expected $code but the operation succeeded")
}

fun main(args: Array<String>) {
    val input = File(args.single())
    val data = JSONObject(input.readText())
    val directory = input.parentFile
    val endpoint = data.getString("endpoint")
    val vault = HostVault(File(directory, "fictional-session.json"))
    val client = syncHttpClient()
    expectIssue("API_ADDRESS") { apiBase(endpoint) }
    val original = UploadSnapshot.parse(data.getJSONObject("snapshot"))
    val progressFile = File(directory, "progress.json")
    fun save(value: Progress) { progressFile.writeText(value.json().toString()) }
    fun progress() = if (progressFile.exists()) Progress.parse(JSONObject(progressFile.readText())) else Progress()
    fun session() = EncoderSession(client, vault, allowTestLoopback = true)
    val login = session()
    val encoder = login.login(endpoint, data.getString("email"), data.getString("password"))
    val scope = encoder.id
    fun bytes(page: PageUpload) = File(directory, "page-${page.number}.png").readBytes()
    fun transfer() = SyncProtocol(session().remote(scope, encoder.endpoint))
        .transfer(UploadSnapshot.parse(JSONObject(original.json().toString())), progress(), ::bytes, ::save)

    // Each attempt uses a new session object and reloads the snapshot and persisted checkpoint.
    expectIssue("NETWORK") { transfer() }
    check(progress().serverId == null)
    expectIssue("NETWORK") { transfer() }
    check(progress().serverId != null && progress().uploaded.isEmpty())
    val limited = expectIssue("DATABASE_UNAVAILABLE") { transfer() }
    check(limited.temporary && limited.retryAfterMs == 90_000L)
    check(retryDeadline(limited, 0, 1_000L, 2_123L) == 91_000L)
    check(progress().uploaded == setOf(1) && progress().acknowledgedAt == null)
    expectIssue("NETWORK") { transfer() }
    check(progress().fieldsUploaded && progress().uploaded == setOf(1, 2) && progress().state != LocalState.SYNCED)
    val received = transfer()
    check(received.state == LocalState.SYNCED && received.serverState == ServerState.PENDING_VERIFICATION)
    check(received.acknowledgedAt != null && received.syncedAt != null && received == progress())
    check(transfer() == received)

    val otherId = newId()
    expectIssue("AUTH_REQUIRED") { session().remote(otherId, encoder.endpoint).status(received.serverId!!) }
    val invalid = UploadSnapshot.parse(data.getJSONObject("invalidSnapshot"))
    var invalidProgress = Progress()
    val invalidRemote = session().remote(scope, encoder.endpoint)
    val invalidIssue = expectIssue("INVALID_FIELDS") {
        SyncProtocol(invalidRemote).transfer(invalid, invalidProgress, ::bytes) { invalidProgress = it }
    }
    check(!invalidIssue.temporary && "birth_date" in invalidIssue.detail)
    check(invalidProgress.state != LocalState.SYNCED && invalidProgress.acknowledgedAt == null)

    val active = session()
    val activeRemote = active.remote(scope, encoder.endpoint)
    val current = checkNotNull(vault.read())
    val api = SyncApi(client, apiBase(current.endpoint, allowTestLoopback = true))
    val verifier = api.call("POST", "auth/login", JSONObject().put("email", data.getString("verifierEmail"))
        .put("password", data.getString("password")).put("mode", "native")).getString("accessToken")
    val route = "submissions/${received.serverId}"
    fun review(action: String, revision: Int, body: JSONObject) = api.call("POST", "$route/review/$action", body, verifier,
        mapOf("If-Match" to "\"$revision\"", "Idempotency-Key" to newId()))
    val claim = review("claim", received.revision, JSONObject())
    review("return", claim.getInt("revision"), JSONObject().put("notes", "Fictional fixture needs review."))
    val latest = SyncProtocol(activeRemote).applyStatus(original, received, activeRemote.status(received.serverId!!))
    check(latest.state == LocalState.SYNCED && latest.serverState == ServerState.NEEDS_CORRECTION)
    check(latest.acknowledgedAt == received.acknowledgedAt && latest.decision?.outcome == "RETURN")
    save(latest)

    val refreshed = checkNotNull(vault.read())
    api.call("POST", "auth/logout", JSONObject().put("refreshToken", refreshed.refresh))
    expectIssue("AUTH_REQUIRED") { activeRemote.status(received.serverId) }
    check(vault.read()?.refresh == null)
    check(progress().state == LocalState.SYNCED)

    println(JSONObject().put("serverId", received.serverId).put("invalidId", invalidProgress.serverId)
        .put("receipt", received.acknowledgedAt).toString())
}
