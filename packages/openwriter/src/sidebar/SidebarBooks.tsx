/** Book navigation belongs with document navigation. adr: adr/manuscript-engine.md */
import { useEffect, useState } from 'react';
import type { BookDoc } from '../hooks/useBookStatus';
import './SidebarBooks.css';

interface BookItem { title: string; outline: BookDoc; manuscript: BookDoc | null }

export default function SidebarBooks({ activeFilename, refreshKey, onSwitchDocument }: {
  activeFilename?: string;
  refreshKey: number;
  onSwitchDocument: (filename: string) => void;
}) {
  const [books, setBooks] = useState<BookItem[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch('/api/books', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('Books unavailable'); return r.json(); })
      .then(data => { if (!controller.signal.aborted) setBooks(data.books || []); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, retry]);

  return (
    <section className="sidebar-books" aria-label="Books">
      <button type="button" className="sidebar-books__heading" data-sidebar-row
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d={expanded ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'} stroke="currentColor" strokeWidth="1.5" />
        </svg>
        Books
      </button>
      {expanded && (
        <div className="sidebar-books__body" aria-busy={loading}>
          {loading ? <p className="sidebar-books__note">Loading books…</p> : error ? (
            <p className="sidebar-books__note">Couldn’t load books. <button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></p>
          ) : books.length === 0 ? (
            <p className="sidebar-books__note">No books yet. Create a Book outline from the “+” menu.</p>
          ) : (
            <ul className="sidebar-books__list">
              {books.map(book => {
                const target = book.manuscript ?? book.outline;
                const here = !!activeFilename && (activeFilename === book.outline.filename || activeFilename === book.manuscript?.filename);
                return (
                  <li key={book.outline.docId}>
                    <button type="button" data-sidebar-row className="sidebar-books__item"
                      aria-current={here ? 'page' : undefined}
                      onClick={() => onSwitchDocument(target.filename)}
                      title={`Open ${book.manuscript ? 'manuscript' : 'outline'}: ${target.title}`}>
                      <span>{book.title}</span>
                      {!book.manuscript && <span className="sidebar-books__draft">Outline</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
