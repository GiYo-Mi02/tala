package expo.modules.talasync

import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

internal fun apiBase(raw: String, allowTestLoopback: Boolean = false): HttpUrl {
    val url = raw.trim().toHttpUrlOrNull()
    if (url == null || (!url.isHttps && !(allowTestLoopback && url.host == "127.0.0.1")) ||
        url.username.isNotEmpty() || url.password.isNotEmpty() || url.query != null || url.fragment != null ||
        url.encodedPath.trimEnd('/') != "/api/v1"
    ) throw SyncIssue("API_ADDRESS", "Enter the HTTPS address that ends in /api/v1.")
    return url.newBuilder().encodedPath("/api/v1").build()
}

internal fun syncHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .callTimeout(75, TimeUnit.SECONDS)
    .connectTimeout(12, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .writeTimeout(45, TimeUnit.SECONDS)
    .followRedirects(false)
    .followSslRedirects(false)
    .retryOnConnectionFailure(false)
    .build()

/** Binds a blocking OkHttp call to the lifetime of a single worker. */
internal class CallScope {
    private var cancelled = false
    private var call: Call? = null

    @Synchronized fun attach(next: Call) {
        if (cancelled) throw SyncIssue("INTERRUPTED", "The upload was interrupted.", true)
        call = next
    }
    @Synchronized fun detach() { call = null }
    @Synchronized fun cancel() { cancelled = true; call?.cancel() }
}

internal class SyncApi(private val client: OkHttpClient, private val base: HttpUrl, private val scope: CallScope = CallScope()) {
    fun call(
        method: String, path: String, body: JSONObject? = null, bearer: String? = null,
        headers: Map<String, String> = emptyMap(), binary: RequestBody? = null
    ): JSONObject {
        val url = base.newBuilder().apply { path.split('/').forEach { addPathSegment(it) } }.build()
        val request = Request.Builder().url(url).method(method, binary ?: body?.toString()?.toRequestBody(JSON_TYPE))
            .header("Accept", "application/json").apply {
                bearer?.let { header("Authorization", "Bearer $it") }
                headers.forEach { (name, value) -> header(name, value) }
            }.build()
        val call = client.newCall(request)
        scope.attach(call)
        try {
            call.execute().use { response ->
                if (!response.isSuccessful) throw responseIssue(response)
                if (response.code == 204) return JSONObject()
                return readJson(response)
            }
        } catch (error: IOException) {
            if (error is SSLHandshakeException || error is SSLPeerUnverifiedException) {
                throw SyncIssue("TLS_REQUIRED", "The phone could not verify the API certificate. Check the HTTPS server address and certificate.")
            }
            throw SyncIssue("NETWORK", "The API could not be reached. The saved submission can resume when the connection returns.", true)
        } catch (_: JSONException) {
            protocolError()
        } finally {
            scope.detach()
        }
    }

    private fun readJson(response: Response): JSONObject {
        val source = response.body?.source() ?: protocolError()
        if (source.request(2_200_001)) protocolError()
        return JSONObject(source.readUtf8())
    }

    private fun responseIssue(response: Response): SyncIssue {
        val error = try { readJson(response).optJSONObject("error") } catch (_: JSONException) { null } catch (_: SyncIssue) { null }
        val code = error?.optString("code")?.takeIf { it.matches(Regex("[A-Z_]{3,50}")) } ?: "HTTP_${response.code}"
        val fields = error?.optJSONArray("fields")?.let { entries ->
            (0 until minOf(entries.length(), 6)).mapNotNull { i ->
                entries.optString(i).takeIf { it.matches(Regex("[a-zA-Z0-9_.]{1,100}")) }
            }
        }.orEmpty()
        val retryAfter = retryDelay(response.header("Retry-After"), System.currentTimeMillis())
        val detail = when (response.code) {
            400, 422 -> "The server could not validate the submitted values. Check the saved draft." +
                if (fields.isEmpty()) "" else " Fields to review: ${fields.joinToString(", ")}."
            401 -> "Sign in again with the same encoder account to resume."
            403 -> "This account cannot perform the requested action. Check the encoder account."
            404 -> "This record or template is unavailable on the configured server. Check the API address and template version."
            409 -> "The server has a conflicting record or missing intake data. Check this draft and the configured server."
            413 -> "A scan or field snapshot exceeds the server's size limit. Prepare a reviewed replacement or contact the server administrator."
            415 -> "The server rejected the image format. Use an upright JPEG or PNG accepted by the scanner."
            429 -> "The API is busy. Synchronization will resume after the retry delay."
            in 500..599 -> "The server is temporarily unavailable. The submission is still saved."
            else -> "The API rejected this operation. Check the server configuration."
        }
        return SyncIssue(code, detail, response.code == 408 || response.code == 429 || response.code in 500..599, retryAfter, response.code)
    }

    companion object {
        private val JSON_TYPE = "application/json".toMediaType()
    }
}

internal fun retryDelay(value: String?, now: Long): Long {
    if (value == null) return 0
    value.trim().toLongOrNull()?.let { return it.coerceIn(0, (Long.MAX_VALUE - now) / 1000) * 1000 }
    return try {
        val time = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).apply { isLenient = false }.parse(value)?.time ?: 0
        (time - now).coerceAtLeast(0)
    } catch (_: java.text.ParseException) { 0 }
}

internal fun retryDeadline(issue: SyncIssue, retries: Int, now: Long, jitter: Long): Long =
    now + maxOf(minOf(30_000L shl retries.coerceIn(0, 6), 1_800_000L) + jitter, issue.retryAfterMs).coerceAtMost(Long.MAX_VALUE - now)

internal class EncoderRemote(private val api: SyncApi, private val authenticate: ((String) -> JSONObject) -> JSONObject) : UploadRemote {
    private fun mutation(
        method: String, path: String, key: String, body: JSONObject? = null, page: PageUpload? = null, bytes: ByteArray? = null
    ): Mutation {
        val headers = mutableMapOf("Idempotency-Key" to key)
        if (page != null) {
            headers["X-Image-Id"] = page.imageId
            headers["X-Content-SHA256"] = page.digest
        }
        val binary = if (page != null && bytes != null) bytes.toRequestBody(page.mime.toMediaType()) else null
        return Mutation.parse(authenticate { api.call(method, path, body, it, headers, binary) })
    }
    override fun create(snapshot: UploadSnapshot) = mutation("POST", "submissions", snapshot.createKey, snapshot.create)
    override fun status(id: String) = authenticate { api.call("GET", "submissions/$id/status", bearer = it) }
    override fun upload(id: String, page: PageUpload, bytes: ByteArray) =
        mutation("PUT", "submissions/$id/pages/${page.number}", page.key, page = page, bytes = bytes)
    override fun fields(id: String, snapshot: UploadSnapshot) = mutation("PUT", "submissions/$id/fields", snapshot.fieldsKey, snapshot.fields)
    override fun complete(id: String, snapshot: UploadSnapshot) = mutation("POST", "submissions/$id/complete", snapshot.completeKey, JSONObject())
}
