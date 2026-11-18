package expo.modules.talasync

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class TalaSyncModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("TalaSync")

        AsyncFunction("initialize").Coroutine<String> {
            onIo {
                reconcile()
                JSONObject()
            }
        }
        AsyncFunction("overview").Coroutine<String> {
            onIo { overview() }
        }
        AsyncFunction("login") Coroutine { endpoint: String, email: String, password: String ->
            onIo {
                login(endpoint, email, password)
                overview()
            }
        }
        AsyncFunction("logout").Coroutine<String> {
            onIo {
                session.logout()
                overview()
            }
        }
        AsyncFunction("enqueue") Coroutine { payload: String, owner: String, endpoint: String ->
            onIo {
                enqueue(payload, owner, endpoint)
                overview()
            }
        }
        AsyncFunction("retry") Coroutine { id: String ->
            onIo {
                retry(id)
                overview()
            }
        }
        AsyncFunction("refreshStatus") Coroutine { id: String ->
            onIo {
                refreshStatus(id)
                overview()
            }
        }
    }

    private suspend fun onIo(action: SyncService.() -> JSONObject): String = withContext(Dispatchers.IO) {
        try {
            val context = requireNotNull(appContext.reactContext)
            JSONObject().put("data", SyncService.get(context).action()).toString()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val issue = error as? SyncIssue ?: storageIssue()
            JSONObject().put("error", JSONObject().put("code", issue.code).put("message", issue.detail)).toString()
        }
    }
}
