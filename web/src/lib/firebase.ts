import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck,
} from "firebase/app-check";
import { getAuth, signInAnonymously, type Auth, type User } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import {
  fetchAndActivate,
  getRemoteConfig,
  getString,
  type RemoteConfig,
} from "firebase/remote-config";

export interface ModelConfig {
  fastCloudModel: string;
  synthesisCloudModel: string;
  deepCloudModel: string;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  fastCloudModel: "gemini-3.5-flash-lite",
  synthesisCloudModel: "gemini-3.8-flash",
  deepCloudModel: "gemini-4-hydrogen",
};

interface FirebaseBundle {
  app: FirebaseApp;
  ai: AI;
  db: Firestore;
  auth: Auth;
  appCheck: AppCheck | null;
  remoteConfig: RemoteConfig | null;
}

let cachedBundle: FirebaseBundle | null = null;
let cachedModelConfig: ModelConfig = { ...DEFAULT_MODEL_CONFIG };

export function isFirebaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY &&
      import.meta.env.VITE_FIREBASE_PROJECT_ID &&
      import.meta.env.VITE_FIREBASE_APP_ID,
  );
}

export function getFirebaseBundle(): FirebaseBundle {
  if (cachedBundle) return cachedBundle;

  if (!isFirebaseConfigured()) {
    throw new Error(
      "Firebase is not configured. Copy web/.env.example to web/.env.local and fill in your Firebase web app credentials.",
    );
  }

  const app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });

  // Configure Firebase App Check (required by Firebase AI Logic).
  // Debug tokens are permitted for localhost/hackathon testing via env var only.
  let appCheck: AppCheck | null = null;
  const debugTokenEnv = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
  const recaptchaSiteKey = import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY;

  if (typeof self !== "undefined" && debugTokenEnv) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugTokenEnv === "true" ? true : debugTokenEnv;
  }

  if (recaptchaSiteKey || debugTokenEnv) {
    // ReCaptchaV3Provider accepts a placeholder key when debug mode is active locally.
    const siteKey = recaptchaSiteKey || "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });

  const auth = getAuth(app);
  const ai = getAI(app, { backend: new GoogleAIBackend() });

  let remoteConfig: RemoteConfig | null = null;
  try {
    remoteConfig = getRemoteConfig(app);
    remoteConfig.settings.minimumFetchIntervalMillis = 3600_000;
    remoteConfig.defaultConfig = {
      cloud_model_fast: DEFAULT_MODEL_CONFIG.fastCloudModel,
      cloud_model_synthesis: DEFAULT_MODEL_CONFIG.synthesisCloudModel,
      cloud_model_deep: DEFAULT_MODEL_CONFIG.deepCloudModel,
    };
  } catch {
    remoteConfig = null;
  }

  cachedBundle = { app, ai, db, auth, appCheck, remoteConfig };
  return cachedBundle;
}

export async function ensureAnonymousAuth(): Promise<User> {
  const { auth } = getFirebaseBundle();
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export async function loadRemoteModelConfig(): Promise<ModelConfig> {
  try {
    const { remoteConfig } = getFirebaseBundle();
    if (!remoteConfig) return cachedModelConfig;
    await fetchAndActivate(remoteConfig);
    cachedModelConfig = {
      fastCloudModel:
        getString(remoteConfig, "cloud_model_fast") ||
        DEFAULT_MODEL_CONFIG.fastCloudModel,
      synthesisCloudModel:
        getString(remoteConfig, "cloud_model_synthesis") ||
        DEFAULT_MODEL_CONFIG.synthesisCloudModel,
      deepCloudModel:
        getString(remoteConfig, "cloud_model_deep") ||
        DEFAULT_MODEL_CONFIG.deepCloudModel,
    };
  } catch {
    // Keep safe defaults when offline or Remote Config is not yet published.
  }
  return cachedModelConfig;
}

export function getCachedModelConfig(): ModelConfig {
  return cachedModelConfig;
}
