> Graphone can render custom tool result HTML. Ask pi to generate an extension tool that returns `details._html`.

# Graphone Tool Result HTML Rendering

Graphone supports a Graphone-specific tool result convention:

- `ToolResultMessage.details._html` (string)

When present, Graphone sanitizes and renders this HTML in the tool result panel.

## Table of Contents

- [Scope](#scope)
- [Agent-first contract](#agent-first-contract)
- [Rendering behavior](#rendering-behavior)
- [Sanitizer policy](#sanitizer-policy)
- [Extension output requirements](#extension-output-requirements)
- [Minimal extension pattern](#minimal-extension-pattern)
- [Styled HTML example fragment](#styled-html-example-fragment)

## Scope

This feature is **Graphone-specific**. Other pi surfaces may ignore `details._html` and display regular tool result text only.

## Agent-first contract

When implementing an extension tool for Graphone rich output:

1. Return normal `content` text (fallback).
2. Put presentational HTML in `details._html`.
3. Keep `details` object-compatible (JSON-serializable metadata is fine).

Canonical result shape:

```ts
return {
  content: [{ type: "text", text: "Report generated." }],
  details: {
    _html: "<section><h2>Report</h2><p>...</p></section>",
    status: "ok",
  },
};
```

## Rendering behavior

Graphone resolves tool results by `toolCallId`.

Render priority in expanded tool result panel:

1. If sanitized `details._html` exists and is non-empty → render HTML.
2. Else → use existing text rendering path from `content`.

If `_html` is missing, empty, or sanitized to empty, fallback text remains the source of truth for display.

## Sanitizer policy

Graphone sanitizes `_html` before rendering.

Current policy:

- `ALLOWED_URI_REGEXP`: `^(?:https?|mailto|tel):`
- `FORBID_TAGS`: `script`, `object`, `embed`, `form`, `button`
- `ALLOWED_ATTR`: `src`, `href`, `class`, `style`, `srcset`, `alt`, `title`, `width`, `height`, `loading`, `name`, plus a curated set of SVG attributes (for example: `viewBox`, `xmlns`, `fill`, `stroke`, `d`, `points`, `transform`, and accessibility attributes).

Implications:

- Inline `style` attributes are allowed.
- `<style>` blocks are allowed.
- Inline SVG is allowed.
- `<button>` elements are not allowed (use styled `<a>` for presentational actions).
- `javascript:` URLs are stripped/blocked by URI policy.

## Extension output requirements

For robust behavior across Graphone and non-Graphone surfaces:

- Always include meaningful text in `content`.
- Keep HTML self-contained and compact.
- Use semantic tags (`section`, `h2`, `table`, `ul`, `p`, etc.).
- Avoid relying on external scripts/styles.

## Minimal extension pattern

See: `examples/extensions/tool-result-html.ts`

This example demonstrates:

- registering a custom tool
- returning fallback text in `content`
- returning rich, styled HTML in `details._html`

## Styled HTML example fragment

```html
<section
  style="border:1px solid #334155; border-radius:12px; padding:12px; background:linear-gradient(135deg,#0f172a,#1e293b); color:#e2e8f0;"
>
  <h2 style="margin:0 0 8px 0; color:#fff;">Release Report</h2>
  <p style="margin:0 0 10px 0; color:#cbd5e1;">
    Rendered via <code style="color:#67e8f9;">details._html</code>.
  </p>
  <table
    style="width:100%; border-collapse:collapse; border:1px solid #475569;"
  >
    <thead>
      <tr>
        <th style="text-align:left; padding:6px; border:1px solid #475569;">
          Metric
        </th>
        <th style="text-align:left; padding:6px; border:1px solid #475569;">
          Value
        </th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:6px; border:1px solid #475569;">Status</td>
        <td
          style="padding:6px; border:1px solid #475569; color:#86efac; font-weight:700;"
        >
          OK
        </td>
      </tr>
    </tbody>
  </table>
</section>
```
