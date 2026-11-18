package expo.modules.talasync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class DeviceCipher {
    private val key: SecretKey by lazy {
        synchronized(KEY_LOCK) {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey(KEY_ALIAS, null) as? SecretKey) ?: KeyGenerator
                .getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                    init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256).build())
                }.generateKey()
        }
    }

    fun seal(bytes: ByteArray, purpose: String): ByteArray = Cipher.getInstance("AES/GCM/NoPadding").run {
        init(Cipher.ENCRYPT_MODE, key)
        updateAAD(purpose.toByteArray())
        check(iv.size == 12)
        iv + doFinal(bytes)
    }

    fun open(bytes: ByteArray, purpose: String): ByteArray = Cipher.getInstance("AES/GCM/NoPadding").run {
        require(bytes.size >= 28)
        init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes, 0, 12))
        updateAAD(purpose.toByteArray())
        doFinal(bytes, 12, bytes.size - 12)
    }

    companion object {
        private const val KEY_ALIAS = "tala.sync.aes.v1"
        private val KEY_LOCK = Any()
    }
}

internal class AndroidCredentialVault(context: Context, private val cipher: DeviceCipher) : CredentialVault {
    private val preferences = context.getSharedPreferences("tala-sync-session", Context.MODE_PRIVATE)

    override fun read(): Encoder? = preferences.getString("encoder", null)?.let { entry ->
        val protected = android.util.Base64.decode(entry, android.util.Base64.NO_WRAP)
        Encoder.parse(JSONObject(cipher.open(protected, "encoder").decodeToString()))
    }

    override fun write(encoder: Encoder?) {
        val editor = preferences.edit()
        if (encoder == null) editor.remove("encoder")
        else editor.putString("encoder", android.util.Base64.encodeToString(
            cipher.seal(encoder.json().toString().toByteArray(), "encoder"), android.util.Base64.NO_WRAP
        ))
        if (!editor.commit()) throw storageIssue()
    }
}

internal fun storageIssue() = SyncIssue("LOCAL_STORAGE", "The phone could not save synchronization progress. Free storage and retry. Your local draft is retained.")
internal fun imageIssue() = SyncIssue("LOCAL_IMAGE", "An accepted scan is missing or unreadable. Review the draft and accept the page again.")

internal data class JobAddress(val id: String, val owner: String, val endpoint: String)
internal data class StoredJob(val address: JobAddress, val snapshot: UploadSnapshot, val progress: Progress)

internal class SyncStorage(private val context: Context, private val cipher: DeviceCipher) {
    private val pageRoot = File(context.noBackupFilesDir, "tala-sync-pages")
    private val database = Room.databaseBuilder(context, SyncOutboxDatabase::class.java, "tala-sync.db")
        .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
        .addCallback(object : RoomDatabase.Callback() {
            override fun onOpen(db: SupportSQLiteDatabase) { db.execSQL("PRAGMA synchronous=FULL") }
        })
        .build()
    private val outbox get() = database.outbox()

    fun addresses(): List<JobAddress> = outbox.addresses().map { JobAddress(it.id, it.owner, it.endpoint) }

    fun load(id: String): StoredJob? = outbox.find(id)?.let { row ->
        val address = JobAddress(row.id, row.owner, row.endpoint)
        StoredJob(address, UploadSnapshot.parse(readJson(row.snapshot, "snapshot", address)), progress(row.progress, address))
    }

    fun latest(id: String): Progress? = outbox.latest(id)?.let { progress(it.progress, JobAddress(it.id, it.owner, it.endpoint)) }

    fun list(encoder: Encoder, state: LocalState? = null): JSONArray = JSONArray().apply {
        for (row in outbox.list(encoder.id, encoder.endpoint, state?.name)) {
            val address = JobAddress(row.id, row.owner, row.endpoint)
            put(progress(row.progress, address).json().put("clientSubmissionId", address.id)
                .put("templateId", row.template).put("capturedAt", row.capturedAt).put("pageCount", row.pageCount))
        }
    }

    fun enqueue(encoder: Encoder, draft: JSONObject): JobAddress = synchronized(ENQUEUE_LOCK) {
        val create = draft.getJSONObject("create")
        val id = create.getString("clientSubmissionId")
        require(uuidPattern.matches(id))
        val address = JobAddress(id, encoder.id, encoder.endpoint)
        val existing = load(id)
        if (existing != null) {
            if (existing.address != address) {
                throw SyncIssue("DRAFT_BOUND", "This draft was queued for a different encoder or API address. Sign in to that account to see it.")
            }
            return@synchronized address
        }
        val captured = create.getString("capturedAt")
        val templateId = create.getString("templateId")
        require(timestampPattern.matches(captured) && create.getInt("templateVersion") > 0 && templateId.matches(Regex("[a-z0-9-]{1,100}")))
        val sourcePages = draft.getJSONArray("pages").objects()
        require(sourcePages.size in 1..3)
        val fields = draft.getJSONObject("fields")
        require(fields.getJSONArray("fields").length() in 1..300)
        val directory = File(pageRoot, id)
        prepareDirectory(directory)
        val uploadedPages = mutableListOf<PageUpload>()
        try {
            for (source in sourcePages) {
                val number = source.getInt("number")
                val imageId = source.getString("imageId")
                require(number in 1..50 && uuidPattern.matches(imageId) && uploadedPages.none { it.number == number || it.imageId == imageId })
                val file = acceptedFile(source.getString("uri"), id, imageId)
                val bytes = file.readBytes().takeIf { it.isNotEmpty() && it.size <= MAX_PAGE_BYTES } ?: throw imageIssue()
                val mime = when {
                    bytes.size >= 4 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() -> "image/jpeg"
                    bytes.take(8) == PNG_SIGNATURE -> "image/png"
                    else -> throw imageIssue()
                }
                val page = PageUpload(number, imageId, mime, bytes.size, sha256(bytes), newId())
                FileOutputStream(pageFile(address, page)).use { fileOutput ->
                    fileOutput.write(cipher.seal(bytes, pagePurpose(address, page)))
                    fileOutput.fd.sync()
                }
                uploadedPages.add(page)
            }
            val payload = UploadSnapshot(create, fields, uploadedPages, newId(), newId(), newId())
            val initial = Progress()
            val row = SyncOutboxDatabase.Record().apply {
                this.id = address.id
                owner = encoder.id
                endpoint = encoder.endpoint
                template = templateId
                capturedAt = captured
                pageCount = uploadedPages.size
                createdAt = System.currentTimeMillis()
                state = initial.state.name
                snapshot = protect(payload.json(), "snapshot", address)
                progress = protect(initial.json(), "progress", address)
            }
            outbox.insert(row)
        } catch (error: Exception) {
            // Keep staged files on an ambiguous database error. A retry can clear them only when the row is absent.
            if (error is SyncIssue) throw error
            throw storageIssue()
        }
        address
    }

    fun save(address: JobAddress, next: Progress, previous: LocalState? = null): Boolean {
        val changed = outbox.save(address.id, address.owner, address.endpoint, next.state.name,
            protect(next.json(), "progress", address), previous?.name)
        if (previous == null && changed != 1) throw storageIssue()
        return changed == 1
    }

    fun loadPage(address: JobAddress, page: PageUpload): ByteArray = try {
        val file = pageFile(address, page)
        if (file.length() != page.size + 28L) throw imageIssue()
        cipher.open(file.readBytes(), pagePurpose(address, page))
    } catch (_: Exception) { throw imageIssue() }

    private fun prepareDirectory(dir: File) {
        if (!dir.exists() && !dir.mkdirs()) throw storageIssue()
        for (partial in dir.listFiles() ?: throw storageIssue()) {
            if (!partial.isFile || !partial.name.matches(Regex("[0-9]{1,2}\\.enc")) || !partial.delete()) throw storageIssue()
        }
    }

    private fun acceptedFile(uri: String, draft: String, image: String): File = try {
        val file = File(URI(uri)).canonicalFile
        val roots = listOf("tala-drafts", "tala-fixed-forms")
        val allowed = roots.any { root -> file == File(context.filesDir, "$root/$draft/$image.jpg").canonicalFile }
        if (!allowed || !file.isFile || file.length() !in 1L..MAX_PAGE_BYTES.toLong()) throw imageIssue()
        file
    } catch (_: Exception) { throw imageIssue() }

    private fun addressPurpose(kind: String, address: JobAddress) = "$kind:${address.owner}:${address.endpoint}:${address.id}"
    private fun pagePurpose(address: JobAddress, page: PageUpload) = addressPurpose("page:${page.number}:${page.imageId}", address)
    private fun pageFile(address: JobAddress, page: PageUpload) = File(File(pageRoot, address.id), "${page.number}.enc")
    private fun protect(json: JSONObject, kind: String, address: JobAddress) =
        cipher.seal(json.toString().toByteArray(), addressPurpose(kind, address))
    private fun readJson(bytes: ByteArray, kind: String, address: JobAddress) =
        JSONObject(cipher.open(bytes, addressPurpose(kind, address)).decodeToString())
    private fun progress(bytes: ByteArray, address: JobAddress) = Progress.parse(readJson(bytes, "progress", address))

    companion object {
        private const val MAX_PAGE_BYTES = 25_000_000
        private val PNG_SIGNATURE = listOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a).map(Int::toByte)
        private val ENQUEUE_LOCK = Any()
    }
}
