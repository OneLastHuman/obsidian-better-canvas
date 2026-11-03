import { setLanguage } from "./i18n";

// The existing suites assert the Chinese copy; keep that locale stable here.
// Individual tests can switch language through setLanguage when they cover the
// English variant.
setLanguage("zh");
