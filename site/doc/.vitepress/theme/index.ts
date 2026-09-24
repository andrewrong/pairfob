import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import ChromeLinks from "./ChromeLinks.vue";
import IntroPath from "./IntroPath.vue";
import ScreenLinks from "./ScreenLinks.vue";
import "./custom.css";
import "./intro.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("IntroPath", IntroPath);
  },
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "nav-bar-content-after": () => h(ChromeLinks),
      "nav-screen-content-after": () => h(ScreenLinks),
    }),
};
