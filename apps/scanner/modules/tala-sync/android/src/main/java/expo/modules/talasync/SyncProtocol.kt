package expo.modules.talasync

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

internal val uuidPattern = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")
internal val digestPattern = Regex("[0-9a-f]{64}")
internal val timestampPattern = Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z")
internal fun newId() = UUID.randomUUID().toString()
internal fun JSONObject.optionalString(key: String) = if (isNull(key)) null else getString(key)
internal fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }
internal fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

internal enum class LocalState { LOCAL_DRAFT, QUEUED, SYNCING, SYNCED, SYNC_FAILED, SYNC_BLOCKED }
internal enum class ServerState {
    DRAFT, UPLOADING, PENDING_VERIFICATION, IN_REVIEW, NEEDS_CORRECTION, VERIFIED, REJECTED, FINALIZED, EXPIRED
}

internal data class PageUpload(
    val number: Int, val imageId: String, val mime: String, val size: Int, val digest: String, val key: String
) {
    fun json() = JSONObject().put("number", number).put("imageId", imageId).put("mime", mime)
        .put("size", size).put("digest", digest).put("key", key)

    companion object {
        fun parse(value: JSONObject) = PageUpload(
            value.getInt("number"), value.getString("imageId"), value.getString("mime"),
            value.getInt("size"), value.getString("digest"), value.getString("key")
        )
    }
}

internal data class UploadSnapshot(
    val create: JSONObject, val fields: JSONObject, val pages: List<PageUpload>,
    val createKey: String, val fieldsKey: String, val completeKey: String
) {
    val id: String get() = create.getString("clientSubmissionId")
    fun json() = JSONObject().put("create", create).put("fields", fields)
        .put("pages", JSONArray(pages.map(PageUpload::json))).put("createKey", createKey)
        .put("fieldsKey", fieldsKey).put("completeKey", completeKey)

    companion object {
        fun parse(value: JSONObject) = UploadSnapshot(
            value.getJSONObject("create"), value.getJSONObject("fields"), value.getJSONArray("pages").objects().map(PageUpload::parse),
            value.getString("createKey"), value.getString("fieldsKey"), value.getString("completeKey")
        )
    }
}

internal data class Decision(val outcome: String, val notes: String?, val at: String) {
    fun json() = JSONObject().put("outcome", outcome).put("notes", notes ?: JSONObject.NULL).put("at", at)
    companion object {
        fun parse(json: JSONObject) = Decision(json.getString("outcome"), json.optionalString("notes"), json.getString("at"))
    }
}

internal data class Progress(
    val state: LocalState = LocalState.QUEUED,
    val serverId: String? = null, val serverState: ServerState? = null, val revision: Int = 0,
    val uploaded: Set<Int> = emptySet(), val fieldsUploaded: Boolean = false,
    val acknowledgedAt: String? = null, val syncedAt: Long? = null,
    val lastAttempt: Long? = null, val retries: Int = 0, val retryAt: Long = 0,
    val issueCode: String? = null, val issueText: String? = null, val decision: Decision? = null
) {
    fun json() = JSONObject().put("state", state.name).put("serverId", serverId).put("serverState", serverState?.name)
        .put("revision", revision).put("uploaded", JSONArray(uploaded.sorted())).put("fieldsUploaded", fieldsUploaded)
        .put("acknowledgedAt", acknowledgedAt).put("syncedAt", syncedAt).put("lastAttempt", lastAttempt)
        .put("retries", retries).put("retryAt", retryAt).put("issueCode", issueCode).put("issueText", issueText)
        .put("decision", decision?.json())

    companion object {
        fun parse(json: JSONObject): Progress {
            val pages = json.getJSONArray("uploaded")
            return Progress(
                LocalState.valueOf(json.getString("state")), json.optionalString("serverId"),
                json.optionalString("serverState")?.let(ServerState::valueOf), json.getInt("revision"),
                (0 until pages.length()).map(pages::getInt).toSet(), json.optBoolean("fieldsUploaded"),
                json.optionalString("acknowledgedAt"), json.optLong("syncedAt").takeIf { it > 0 },
                json.optLong("lastAttempt").takeIf { it > 0 }, json.optInt("retries"), json.optLong("retryAt"),
                json.optionalString("issueCode"), json.optionalString("issueText"), json.optJSONObject("decision")?.let(Decision::parse)
            )
        }
    }
}

internal class SyncIssue(
    val code: String, val detail: String, val temporary: Boolean = false, val retryAfterMs: Long = 0, val httpStatus: Int = 0
) : Exception(detail)

internal fun protocolError(): Nothing = throw SyncIssue("INVALID_RESPONSE", "The API returned an unexpected response. Check the server address and retry.")
internal fun conflict(): Nothing = throw SyncIssue("SERVER_CONFLICT", "The server has different evidence for this draft. Keep this copy and prepare a reviewed replacement draft.")

internal data class Mutation(val id: String, val state: ServerState, val revision: Int) {
    companion object {
        fun parse(json: JSONObject) = Mutation(
            json.getString("id").also { if (!uuidPattern.matches(it)) protocolError() },
            ServerState.valueOf(json.getString("status")),
            json.getInt("revision").also { if (it < 1) protocolError() }
        )
    }
}

internal interface UploadRemote {
    fun create(snapshot: UploadSnapshot): Mutation
    fun status(id: String): JSONObject
    fun upload(id: String, page: PageUpload, bytes: ByteArray): Mutation
    fun fields(id: String, snapshot: UploadSnapshot): Mutation
    fun complete(id: String, snapshot: UploadSnapshot): Mutation
}

internal class SyncProtocol(private val remote: UploadRemote, private val now: () -> Long = System::currentTimeMillis) {
    fun transfer(snapshot: UploadSnapshot, previous: Progress, bytes: (PageUpload) -> ByteArray, save: (Progress) -> Unit): Progress {
        var current = previous
        fun record(mutation: Mutation) {
            if (current.serverId != null && current.serverId != mutation.id) protocolError()
            current = if (mutation.revision >= current.revision) {
                current.copy(serverId = mutation.id, serverState = mutation.state, revision = mutation.revision)
            } else current
            save(current)
        }
        if (current.serverId == null) record(remote.create(snapshot))
        val serverId = current.serverId ?: protocolError()
        current = applyStatus(snapshot, current, remote.status(serverId))
        save(current)
        if (current.state == LocalState.SYNCED) return current
        if (current.serverState == ServerState.EXPIRED) {
            throw SyncIssue("SUBMISSION_EXPIRED", "The server expired this incomplete upload. Prepare a new reviewed draft to submit.")
        }
        if (current.serverState !in setOf(ServerState.DRAFT, ServerState.UPLOADING)) protocolError()

        for (page in snapshot.pages.sortedBy(PageUpload::number)) {
            if (page.number in current.uploaded) continue
            val content = bytes(page)
            if (content.size != page.size || sha256(content) != page.digest) {
                throw SyncIssue("LOCAL_IMAGE", "A queued page could not be read intact. Keep this draft and prepare a reviewed replacement.")
            }
            record(remote.upload(serverId, page, content))
            current = current.copy(uploaded = current.uploaded + page.number)
            save(current)
        }
        if (!current.fieldsUploaded) {
            record(remote.fields(serverId, snapshot))
            current = current.copy(fieldsUploaded = true)
            save(current)
        }
        record(remote.complete(serverId, snapshot))
        val finished = applyStatus(snapshot, current, remote.status(serverId))
        if (finished.state != LocalState.SYNCED) protocolError()
        save(finished)
        return finished
    }

    fun applyStatus(snapshot: UploadSnapshot, previous: Progress, json: JSONObject): Progress {
        val state = Mutation.parse(json)
        if (previous.serverId != state.id || json.getString("clientSubmissionId") != snapshot.id ||
            json.getString("templateId") != snapshot.create.getString("templateId") ||
            json.getInt("templateVersion") != snapshot.create.getInt("templateVersion")
        ) protocolError()

        val uploaded = mutableSetOf<Int>()
        for (info in json.getJSONArray("pages").objects()) {
            val number = info.getInt("pageNumber")
            val page = snapshot.pages.singleOrNull { it.number == number } ?: conflict()
            if (!uploaded.add(number) || info.getString("imageId") != page.imageId ||
                info.getString("sha256") != page.digest || info.getString("mimeType") != page.mime ||
                info.getInt("byteSize") != page.size || info.getString("uploadStatus") != "COMPLETE"
            ) conflict()
        }
        val receipt = json.optJSONObject("receipt")
        val acknowledgedAt = receipt?.getString("acknowledgedAt")
        val accepted = state.state !in setOf(ServerState.DRAFT, ServerState.UPLOADING, ServerState.EXPIRED)
        if (accepted != (receipt != null)) protocolError()
        if (receipt != null && !previous.fieldsUploaded) conflict()
        if (receipt != null && (receipt.getString("submissionId") != state.id ||
                acknowledgedAt == null || !timestampPattern.matches(acknowledgedAt) ||
                uploaded.size != snapshot.pages.size || previous.acknowledgedAt?.let { it != acknowledgedAt } == true)
        ) protocolError()
        if (previous.state == LocalState.SYNCED && receipt == null) protocolError()
        if (state.revision < previous.revision) protocolError()

        val next = previous.copy(
            serverState = state.state, revision = state.revision, uploaded = uploaded,
            decision = json.optJSONObject("decision")?.let(Decision::parse)
        )
        if (receipt == null) return next
        return next.copy(
            state = LocalState.SYNCED, fieldsUploaded = true, acknowledgedAt = acknowledgedAt, syncedAt = previous.syncedAt ?: now(),
            retryAt = 0, issueCode = null, issueText = null
        )
    }
}
