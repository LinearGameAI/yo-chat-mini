interface RuntimeEnvironment {
  __MINI_CLIENT_KEY__?: string;
  __isMinisDevMode__?: boolean;
  JS2NativeBridge?: { _invokeMethod?: unknown; call?: unknown };
  ToutiaoJSBridge?: { invokeMethod?: unknown };
  webkit?: { messageHandlers?: { callMethodParams?: { postMessage?: unknown } } };
  callMethodParams?: unknown;
}

// Loading sdk.js or configuring a Client Key does not make a browser a TikTok host.
// These native bridge entry points match the transport detection in the official SDK.
export function playerMode(runtime: RuntimeEnvironment = window): 'local' | 'tiktok' {
  if (!runtime.__MINI_CLIENT_KEY__ || runtime.__MINI_CLIENT_KEY__.startsWith('local-')) return 'local';
  const hasTransport = runtime.__isMinisDevMode__ === true ||
    typeof runtime.JS2NativeBridge?._invokeMethod === 'function' ||
    typeof runtime.JS2NativeBridge?.call === 'function' ||
    typeof runtime.ToutiaoJSBridge?.invokeMethod === 'function' ||
    typeof runtime.webkit?.messageHandlers?.callMethodParams?.postMessage === 'function' ||
    typeof runtime.callMethodParams === 'function';
  return hasTransport ? 'tiktok' : 'local';
}
