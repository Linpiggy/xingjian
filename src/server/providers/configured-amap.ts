import { AmapProvider } from "./amap";

export function configuredAmap(): AmapProvider {
  return new AmapProvider(process.env.AMAP_WEB_SERVICE_KEY ?? "");
}
