"use client";

import { useEffect } from "react";

const COUNT_PREFIX = /^\(\d+\)\s*/;

/**
 * Shows the unread-conversation count in the browser tab title, e.g.
 * "(3) Inbox". The page title itself is left alone: Next rewrites it on
 * every navigation, so a MutationObserver re-applies the prefix.
 */
export function useUnreadTitle(count: number): void {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(COUNT_PREFIX, "");
      const next = count > 0 ? `(${count > 99 ? "99+" : count}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();

    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(COUNT_PREFIX, "");
    };
  }, [count]);
}
