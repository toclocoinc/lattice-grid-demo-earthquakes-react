/**
 * The tab strip.
 *
 * The package ships a tabs module, and it is not used here. It cannot be: it
 * takes `createGrid` and builds every tab's grid itself, which is the opposite
 * of what a React application wants. React has to own the tree, or the grid
 * inside a tab is not a React component and cannot take props, hold a ref, or
 * be composed with anything else on the page. So the strip is written here —
 * a `role="tablist"` of buttons over a stack of `role="tabpanel"` regions —
 * and the grids inside it are ordinary children.
 *
 * Two rules the strip keeps, both of which the shipped module also keeps and
 * both of which matter more than they look:
 *
 *   A tab's content is not created until the tab is first opened. The second
 *   table reads a different dataset, so building it on load would cost a grid
 *   nobody had asked to see.
 *
 *   Once created it is kept, hidden, rather than unmounted. Going back to a
 *   tab should not rebuild it, and a grid that is destroyed and rebuilt loses
 *   the reader's sort, filters and scroll position.
 *
 * A grid measures its own width when it mounts, so it must mount while it is
 * on screen. Deferring creation to first activation is what makes that true
 * here: a tab is always visible at the moment its content first appears.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * @param {object} props
 * @param {{id: string, label: string, badge?: number|null}[]} props.tabs
 * @param {string} props.active
 * @param {(id: string) => void} props.onChange
 * @param {string} props.ariaLabel
 * @param {(id: string) => import('react').ReactNode} props.children a panel's content
 */
export function Tabs({ tabs, active, onChange, ariaLabel, children }) {
  /* Which tabs have ever been opened. Once in, never out. */
  const [seen, setSeen] = useState(() => new Set([active]));
  const buttons = useRef({});

  useEffect(() => {
    setSeen((held) => (held.has(active) ? held : new Set([...held, active])));
  }, [active]);

  /* Left and right move between tabs, Home and End jump to the ends, which is
     what a tablist is expected to do. */
  const onKeyDown = useCallback(
    (event) => {
      const ids = tabs.map((tab) => tab.id);
      const at = ids.indexOf(active);
      let next = null;
      if (event.key === 'ArrowRight') next = ids[(at + 1) % ids.length];
      else if (event.key === 'ArrowLeft') next = ids[(at - 1 + ids.length) % ids.length];
      else if (event.key === 'Home') next = ids[0];
      else if (event.key === 'End') next = ids[ids.length - 1];
      if (!next) return;
      event.preventDefault();
      onChange(next);
      const button = buttons.current[next];
      if (button) button.focus();
    },
    [tabs, active, onChange],
  );

  return (
    <section className="tabs-host">
      <div className="tabstrip" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            className={`tab${tab.id === active ? ' on' : ''}`}
            aria-selected={tab.id === active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            ref={(node) => {
              buttons.current[tab.id] = node;
            }}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {typeof tab.badge === 'number' ? (
              <span className="tab-badge">{tab.badge.toLocaleString('en-GB')}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== active}
        >
          {seen.has(tab.id) ? children(tab.id) : null}
        </div>
      ))}
    </section>
  );
}
