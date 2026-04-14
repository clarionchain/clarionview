import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * ClarionView — Bitcoin Intelligence Knowledge Graph
 * Quartz v4 configuration
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "Bitcoin Intelligence",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "en-US",
    baseUrl: "clarionview.io/intel",
    ignorePatterns: ["private", "templates", ".obsidian"],
    defaultDateType: "created",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Inter",
        body: "Inter",
        code: "JetBrains Mono",
      },
      colors: {
        // Dark-only — matches ClarionView's workbench-shell palette
        lightMode: {
          light: "#0a0e14",
          lightgray: "#161b25",
          gray: "#2d3748",
          darkgray: "#9ca3af",
          dark: "#f1f5f9",
          secondary: "#f7931a",
          tertiary: "#fb923c",
          highlight: "rgba(247, 147, 26, 0.10)",
          textHighlight: "#f7931a55",
        },
        darkMode: {
          light: "#0a0e14",
          lightgray: "#161b25",
          gray: "#2d3748",
          darkgray: "#9ca3af",
          dark: "#f1f5f9",
          secondary: "#f7931a",
          tertiary: "#fb923c",
          highlight: "rgba(247, 147, 26, 0.10)",
          textHighlight: "#f7931a55",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: { light: "github-dark", dark: "github-dark" },
        keepBackground: true,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.NotFoundPage(),
    ],
  },
}

export default config
