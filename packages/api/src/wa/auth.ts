import {
  initAuthCreds,
  proto,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from "@whiskeysockets/baileys";
import {
  clearSignalKeys,
  deleteAuthStateRows,
  listCredentialSessionIds,
  loadCredentials,
  loadSignalKeys,
  saveCredentials,
  saveSignalKeys,
} from "../db/auth.js";

export interface AuthStateHandle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export async function getAuthState(
  sessionId: string,
): Promise<AuthStateHandle> {
  const existing = loadCredentials(sessionId);
  const creds = existing ?? initAuthCreds();
  if (!existing) saveCredentials(sessionId, creds);

  const saveCreds = async () => {
    saveCredentials(sessionId, creds);
  };

  const keys: SignalKeyStore = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const data = loadSignalKeys(sessionId, type, ids) as {
        [id: string]: SignalDataTypeMap[T];
      };
      if (type === "app-state-sync-key") {
        for (const id of Object.keys(data)) {
          const value = data[id] as unknown;
          if (value) {
            (data as Record<string, unknown>)[id] =
              proto.Message.AppStateSyncKeyData.fromObject(
                value as Record<string, unknown>,
              );
          }
        }
      }
      return data;
    },
    async set(data: SignalDataSet) {
      saveSignalKeys(sessionId, data);
    },
    async clear() {
      clearSignalKeys(sessionId);
    },
  };

  return { state: { creds, keys }, saveCreds };
}

export async function deleteAuthState(sessionId: string): Promise<void> {
  deleteAuthStateRows(sessionId);
}

export async function listAuthSessionIds(): Promise<string[]> {
  return listCredentialSessionIds();
}