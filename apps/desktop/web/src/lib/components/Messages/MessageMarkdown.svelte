<script lang="ts" module>
  import hljs from "highlight.js";
  // highlightjs-svelte currently ships without TypeScript typings.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  import registerSvelteLanguage from "highlightjs-svelte";
  import { Marked } from "marked";
  import { markedHighlight } from "marked-highlight";

  if (!hljs.getLanguage("svelte")) {
    registerSvelteLanguage(hljs);
  }

  function resolveHighlightLanguage(lang: string): string {
    const normalized = lang.trim().toLowerCase();

    // Vue isn't available as a built-in highlight.js grammar in this setup.
    // Fallback to XML/HTML highlighting, which still gives useful template colors.
    if (normalized === "vue") {
      return "xml";
    }

    return normalized;
  }

  export const marked = new Marked(
    markedHighlight({
      emptyLangClass: "hljs",
      langPrefix: "hljs language-",
      highlight(code, lang) {
        const resolved = resolveHighlightLanguage(lang);
        const language = hljs.getLanguage(resolved) ? resolved : "plaintext";
        return hljs.highlight(code, { language }).value;
      },
    }),
  );
</script>

<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  import DOMPurify from "dompurify";
  import type { SvelteHTMLElements } from "svelte/elements";

  import { cn } from "$lib/utils/cn";
  import { disambiguateCodeFences } from "$lib/utils/markdown/disambiguateCodeFences";

  let {
    content,
    class: className,
    ...restProps
  }: { content: string; class?: string } & SvelteHTMLElements["div"] = $props();

  function preEscapeDangerousTags(markdown: string): string {
    const lines = markdown.split("\n");
    const escapedLines: string[] = [];

    let activeFence: { marker: "`" | "~"; length: number } | null = null;

    const fencePattern = /^\s{0,3}([`~]{3,})/;

    for (const line of lines) {
      const fenceMatch = line.match(fencePattern);

      if (fenceMatch) {
        const fence = fenceMatch[1] ?? "";
        const marker = fence[0] as "`" | "~";
        const length = fence.length;

        if (!activeFence) {
          activeFence = { marker, length };
        } else if (
          marker === activeFence.marker &&
          length >= activeFence.length
        ) {
          activeFence = null;
        }

        escapedLines.push(line);
        continue;
      }

      if (activeFence) {
        escapedLines.push(line);
        continue;
      }

      escapedLines.push(
        line.replace(/<(\/?)(script|style)(?=\s|>|$)/gi, "&lt;$1$2"),
      );
    }

    return escapedLines.join("\n");
  }

  // Memoized parsing pipeline. These $derived values only recompute when
  // the upstream content string changes, including during streaming deltas.
  const normalizedContent = $derived(content ?? "");
  const parsedContent = $derived(disambiguateCodeFences(normalizedContent));
  const safeMarkdownInput = $derived(preEscapeDangerousTags(parsedContent));

  const rawHtml = $derived(
    String(
      marked.parse(safeMarkdownInput, {
        async: false,
        gfm: true,
        breaks: true,
      }),
    ),
  );

  const html = $derived(
    DOMPurify.sanitize(rawHtml, {
      ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):/,
      FORBID_TAGS: [
        "script",
        "object",
        "embed",
        "form",
        "style",
        "svg",
        "button",
      ],
      ALLOWED_ATTR: [
        "src",
        "href",
        "class",
        "srcset",
        "alt",
        "title",
        "width",
        "height",
        "loading",
        "name",
      ],
    }),
  );
</script>

<div class={cn("message-markdown", className)} {...restProps}>
  {@html html}
</div>

<style lang="postcss">
  .message-markdown :global(h1),
  .message-markdown :global(h2),
  .message-markdown :global(h3),
  .message-markdown :global(h4),
  .message-markdown :global(h5),
  .message-markdown :global(h6) {
    font-weight: 700;
    line-height: 1.35;
    margin: 0.95em 0 0.45em;
  }

  .message-markdown :global(h1) {
    font-size: 1.15em;
  }

  .message-markdown :global(h2) {
    font-size: 1.08em;
  }

  .message-markdown :global(h3) {
    font-size: 1.02em;
  }

  .message-markdown :global(h4),
  .message-markdown :global(h5),
  .message-markdown :global(h6) {
    font-size: 0.97em;
  }

  .message-markdown :global(h1:first-child),
  .message-markdown :global(h2:first-child),
  .message-markdown :global(h3:first-child),
  .message-markdown :global(h4:first-child),
  .message-markdown :global(h5:first-child),
  .message-markdown :global(h6:first-child) {
    margin-top: 0;
  }

  .message-markdown :global(p) {
    margin: 0.65em 0;
  }

  .message-markdown :global(p:first-child) {
    margin-top: 0;
  }

  .message-markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  .message-markdown :global(ul),
  .message-markdown :global(ol) {
    margin: 0.45em 0;
    padding-left: 1.45rem;
    list-style-position: outside;
  }

  .message-markdown :global(ul) {
    list-style: disc;
  }

  .message-markdown :global(ol) {
    list-style: decimal;
  }

  .message-markdown :global(li) {
    display: list-item;
    margin: 0.2em 0;
    padding-left: 0.2rem;
  }

  .message-markdown :global(li > p) {
    margin: 0.2em 0;
  }

  .message-markdown :global(li > p:first-child) {
    margin-top: 0;
  }

  .message-markdown :global(li > p:last-child) {
    margin-bottom: 0;
  }

  .message-markdown :global(ul ul) {
    list-style-type: circle;
  }

  .message-markdown :global(ol ol) {
    list-style-type: lower-alpha;
  }

  .message-markdown :global(blockquote) {
    margin: 0.7em 0;
    padding: 0.35em 0.8em;
    border-left: 3px solid var(--border);
    color: var(--muted-foreground);
    background: color-mix(in srgb, var(--foreground) 3%, transparent);
  }

  .message-markdown :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: color-mix(in srgb, var(--foreground) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
    border-radius: 0.22rem;
    padding: 0.06rem 0.3rem;
  }

  .message-markdown :global(pre) {
    margin: 0.7em 0;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: color-mix(in srgb, var(--foreground) 4%, transparent);
    overflow-x: auto;
    line-height: 1.4;
  }

  .message-markdown :global(pre code) {
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0;
    display: block;
    min-width: 100%;
    width: max-content;
  }

  .message-markdown :global(a) {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .message-markdown :global(a:hover) {
    text-decoration: none;
  }

  .message-markdown :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.9em 0;
  }

  .message-markdown :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.75em 0;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    overflow: hidden;
  }

  .message-markdown :global(th),
  .message-markdown :global(td) {
    border: 1px solid var(--border);
    text-align: left;
    padding: 0.35rem 0.5rem;
    vertical-align: top;
  }

  .message-markdown :global(thead) {
    background: color-mix(in srgb, var(--foreground) 6%, transparent);
  }

  .message-markdown :global(.hljs-comment),
  .message-markdown :global(.hljs-quote) {
    color: color-mix(in srgb, var(--muted-foreground) 92%, transparent);
  }

  .message-markdown :global(.hljs-keyword),
  .message-markdown :global(.hljs-selector-tag),
  .message-markdown :global(.hljs-built_in),
  .message-markdown :global(.hljs-name),
  .message-markdown :global(.hljs-title) {
    color: color-mix(in srgb, #5dc5ff 80%, var(--foreground));
  }

  .message-markdown :global(.hljs-string),
  .message-markdown :global(.hljs-attr),
  .message-markdown :global(.hljs-literal),
  .message-markdown :global(.hljs-number) {
    color: color-mix(in srgb, #8bdd96 80%, var(--foreground));
  }

  /* Read-tool result already sits inside a bordered container; keep code block plain. */
  .message-markdown.message-markdown-read :global(pre) {
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
  }

  .message-markdown.message-markdown-read :global(pre code) {
    min-width: 0;
    width: auto;
  }
</style>
