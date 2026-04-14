import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// Shared components used on every page
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: {
      ClarionView: "https://clarionview.io",
      "Bitcoin Intelligence": "https://clarionview.io/intel",
    },
  }),
}

// Default layout for content pages (narratives, entities, topics)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.Breadcrumbs(),
    Component.ArticleTitle(),
    Component.ContentMeta(),
    Component.TagList(),
  ],
  afterBody: [],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Search(),
    Component.Darkmode(),
    Component.DesktopOnly(Component.Explorer()),
  ],
  right: [
    Component.Graph({
      localGraph: {
        depth: 2,
        scale: 1.1,
        repulseStrength: 0.5,
        centerForce: 0.3,
        linkDistance: 35,
        fontSize: 0.6,
        opacityScale: 1.0,
        showTags: true,
        removeSelfLoops: true,
      },
      globalGraph: {
        depth: -1,
        scale: 0.9,
        repulseStrength: 0.5,
        centerForce: 0.3,
        linkDistance: 30,
        fontSize: 0.45,
        opacityScale: 1.0,
        showTags: false,
        removeSelfLoops: true,
      },
    }),
    Component.DesktopOnly(Component.TableOfContents()),
    Component.Backlinks(),
  ],
}

// List page layout (folder pages, tag pages)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [
    Component.Breadcrumbs(),
    Component.ArticleTitle(),
    Component.ContentMeta(),
  ],
  afterBody: [],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Search(),
    Component.Darkmode(),
    Component.DesktopOnly(Component.Explorer()),
  ],
  right: [],
}
