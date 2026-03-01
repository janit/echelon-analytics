import { define } from "../utils.ts";

export default define.page(function App({ Component, url }) {
  // Admin pages render their own full HTML document (with AdminNav).
  if (url.pathname.startsWith("/admin")) {
    return <Component />;
  }

  // API and tracking routes don't need a layout.
  return <Component />;
});
