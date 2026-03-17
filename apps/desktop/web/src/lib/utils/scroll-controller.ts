/**
 * Scroll controller for message containers.
 * Provides debounced RAF-throttled scroll operations and pin-to-bottom detection.
 */

export class ScrollController {
  private scrollRaf: number | null = null;
  private resizeScrollRaf: number | null = null;

  /**
   * Schedule a non-smooth scroll to bottom, throttled to one per animation frame.
   * Useful for high-frequency streaming events where smooth scroll can fall behind.
   */
  scheduleScrollToBottom(scrollFn: () => void): void {
    if (this.scrollRaf === null) {
      this.scrollRaf = requestAnimationFrame(() => {
        scrollFn();
        this.scrollRaf = null;
      });
    }
  }

  /**
   * Schedule a scroll-to-bottom only if the view is currently pinned to the bottom.
   * Used for resize events to maintain pin state without jarring jumps.
   */
  schedulePinnedResizeScroll(
    scrollFn: () => void,
    isPinnedToBottom: () => boolean,
  ): void {
    if (this.resizeScrollRaf !== null) return;

    this.resizeScrollRaf = requestAnimationFrame(() => {
      this.resizeScrollRaf = null;

      if (!isPinnedToBottom()) return;
      scrollFn();
    });
  }

  /**
   * Set up a ResizeObserver on a content element that triggers pinned resize scroll.
   * Returns a cleanup function to disconnect the observer.
   */
  observeContentResize(
    contentElement: HTMLElement | null,
    scrollFn: () => void,
    isPinnedToBottom: () => boolean,
  ): () => void {
    if (!contentElement) return () => {};

    const resizeObserver = new ResizeObserver(() => {
      this.schedulePinnedResizeScroll(scrollFn, isPinnedToBottom);
    });

    resizeObserver.observe(contentElement);

    return () => {
      resizeObserver.disconnect();
    };
  }

  /**
   * Cancel all pending RAF operations.
   */
  cancelAll(): void {
    if (this.scrollRaf !== null) {
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = null;
    }

    if (this.resizeScrollRaf !== null) {
      cancelAnimationFrame(this.resizeScrollRaf);
      this.resizeScrollRaf = null;
    }
  }
}
