package expo.modules.talasync

import okhttp3.OkHttpClient
import org.json.JSONException
import org.json.JSONObject

internal data class Encoder(
    val id: String, val email: String, val endpoint: String, val generation: String, val refresh: String?
) {
    fun json() = JSONObject().put("id", id).put("email", email).put("endpoint", endpoint)
        .put("generation", generation).put("refresh", refresh)

    fun publicJson() = JSONObject().put("id", id).put("email", email).put("endpoint", endpoint).put("signInRequired", refresh == null)

    companion object {
        fun parse(json: JSONObject) = Encoder(
            json.getString("id"), json.getString("email"), json.getString("endpoint"),
            json.getString("generation"), json.optionalString("refresh")
        )
    }
}

internal interface CredentialVault {
    fun read(): Encoder?
    fun write(encoder: Encoder?)
}

internal fun signInRequired(): SyncIssue = SyncIssue("AUTH_REQUIRED", "Sign in again with the same encoder account and API address to resume.")

internal class EncoderSession(
    private val client: OkHttpClient, private val vault: CredentialVault, private val allowTestLoopback: Boolean = false
) {
    private data class Tokens(val access: String, val refresh: String, val lifetime: Int)
    private data class Access(val generation: String, val token: String, val expires: Long)
    private val lock = Any()
    private var access: Access? = null

    fun current() = vault.read()

    fun login(endpoint: String, email: String, password: String): Encoder {
        val base = apiBase(endpoint, allowTestLoopback)
        val api = SyncApi(client, base)
        val tokens = tokens(api.call("POST", "auth/login",
            JSONObject().put("email", email.trim()).put("password", password).put("mode", "native")))
        val account = api.call("GET", "auth/me", bearer = tokens.access)
        if (account.optString("role") != "ENCODER") {
            runCatching { api.call("POST", "auth/logout", JSONObject().put("refreshToken", tokens.refresh)) }
            throw SyncIssue("NOT_ENCODER", "Sign in with an encoder account to upload scans.")
        }
        val id = account.optString("id")
        val identity = account.optString("email")
        if (!uuidPattern.matches(id) || identity.isBlank()) protocolError()
        val encoder = Encoder(id, identity, base.toString(), newId(), tokens.refresh)
        synchronized(lock) {
            vault.write(encoder)
            saveAccess(encoder, tokens)
        }
        return encoder
    }

    fun logout() {
        val previous = synchronized(lock) {
            val encoder = vault.read()
            vault.write(null)
            access = null
            encoder
        }
        previous?.refresh?.let {
            runCatching { SyncApi(client, apiBase(previous.endpoint, allowTestLoopback))
                .call("POST", "auth/logout", JSONObject().put("refreshToken", it)) }
        }
    }

    fun remote(owner: String, endpoint: String, scope: CallScope = CallScope()): UploadRemote {
        val api = SyncApi(client, apiBase(endpoint, allowTestLoopback), scope)
        return EncoderRemote(api) { request -> authorized(owner, endpoint, api, request) }
    }

    private fun authorized(owner: String, endpoint: String, api: SyncApi, request: (String) -> JSONObject): JSONObject {
        val first = token(owner, endpoint, api, null)
        try { return request(first) }
        catch (failure: SyncIssue) { if (failure.httpStatus != 401) throw failure }
        val second = token(owner, endpoint, api, first)
        try { return request(second) }
        catch (failure: SyncIssue) {
            if (failure.httpStatus != 401) throw failure
            synchronized(lock) {
                val encoder = vault.read()
                if (encoder != null && encoder.id == owner && encoder.endpoint == endpoint && access?.token == second) {
                    vault.write(encoder.copy(refresh = null))
                    access = null
                }
            }
            throw signInRequired()
        }
    }

    private fun token(owner: String, endpoint: String, api: SyncApi, rejected: String?): String = synchronized(lock) {
        val encoder = vault.read()
        val refresh = encoder?.refresh
        if (encoder == null || encoder.id != owner || encoder.endpoint != endpoint || refresh == null) throw signInRequired()
        val cached = access
        if (cached != null && cached.generation == encoder.generation && cached.expires > System.currentTimeMillis() && cached.token != rejected) {
            return@synchronized cached.token
        }
        val next = try { tokens(api.call("POST", "auth/refresh", JSONObject().put("refreshToken", refresh))) }
        catch (failure: SyncIssue) {
            if (failure.httpStatus != 401) throw failure
            vault.write(encoder.copy(refresh = null))
            access = null
            throw signInRequired()
        }
        vault.write(encoder.copy(refresh = next.refresh))
        saveAccess(encoder, next)
        next.access
    }

    private fun saveAccess(encoder: Encoder, tokens: Tokens) {
        access = Access(encoder.generation, tokens.access, System.currentTimeMillis() + (tokens.lifetime * 1000L - 3_000L).coerceAtLeast(0))
    }

    private fun tokens(json: JSONObject): Tokens {
        try {
            val access = json.getString("accessToken")
            val refresh = json.getString("refreshToken")
            val lifetime = json.getInt("expiresIn")
            val token = Regex("[A-Za-z0-9_-]{43}")
            if (json.getString("tokenType") != "Bearer" || !token.matches(access) || !token.matches(refresh) || lifetime !in 0..900) protocolError()
            return Tokens(access, refresh, lifetime)
        } catch (_: JSONException) { protocolError() }
    }
}
