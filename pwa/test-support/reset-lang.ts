/**
 * i18n keeps its language in a module-level variable, and `bun test src` runs every file in one process,
 * so a test that flips it to "en" (setLang, initI18n, detectLang on an en-* navigator) leaked into every
 * later file asserting Chinese copy. Start each test from the default.
 */
import { beforeEach } from "bun:test";
import { setLang } from "../src/lib/i18n";

beforeEach(() => { setLang("zh"); });
