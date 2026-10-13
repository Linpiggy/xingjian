/// <reference types="@amap/amap-jsapi-types" />

declare module "@amap/amap-jsapi-loader" {
  const loader: {
    load(options: {
      key: string;
      version: string;
      plugins?: string[];
    }): Promise<typeof AMap>;
    reset(): void;
  };
  export default loader;
}
interface Window {
  _AMapSecurityConfig?: { serviceHost: string };
}
