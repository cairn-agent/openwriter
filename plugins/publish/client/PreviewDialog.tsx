/**
 * See a post as a reader before they do: the web page as a visitor, a free, paid or founding
 * reader, or the email, drawn by the publish server exactly as it will be sent (preview_site_post).
 * From here the writer can send that version to their own inbox (send_test_email).
 */
import { useEffect, useState } from 'react';
import { run } from './api';
import { ActionBtn, Dialog, Failed, Loading, Tabs } from './ui';

type As = 'visitor' | 'free' | 'paid' | 'founding';
type Format = 'web' | 'email';

interface Preview { html: string; base_url?: string; subject?: string }

/** The preview's html with its links resolved against the site, and no scripts (the frame allows none). */
function framed(p: Preview): string {
  const base = p.base_url ? `<base href="${p.base_url.replace(/"/g, '&quot;')}" target="_blank">` : '';
  return /<head[^>]*>/i.test(p.html) ? p.html.replace(/<head([^>]*)>/i, `<head$1>${base}`) : `${base}${p.html}`;
}

export default function PreviewDialog({ postId, title, onClose, paid }: { postId?: string; title: string; onClose: () => void; paid?: boolean }) {
  const [as, setAs] = useState<As>(paid ? 'free' : 'visitor');
  const [format, setFormat] = useState<Format>('web');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPreview(null); setError(null);
    const who = format === 'email' && as === 'visitor' ? 'free' : as;
    run<Preview>('preview_site_post', { ...(postId ? { post_id: postId } : {}), as: who, format })
      .then((p) => { if (live) setPreview(p); })
      .catch((err: any) => { if (live) setError(err?.message || 'The preview did not load.'); });
    return () => { live = false; };
  }, [as, format, postId]);

  const testAs = as === 'visitor' ? 'free' : as;
  return (
    <Dialog title={`Preview: ${title}`} onClose={onClose} wide
      footer={
        <ActionBtn kind="primary" label={`Send this as a test email to me`} doing="Sending..."
          run={() => run('send_test_email', { ...(postId ? { post_id: postId } : {}), as: testAs })}
          done={(r) => `Test email sent to ${r?.sent_to || 'you'}.`} />
      }>
      <div className="ows-preview-bar">
        <Tabs label="Show as" value={format} onChange={setFormat} options={[{ value: 'web', label: 'Web page' }, { value: 'email', label: 'Email' }]} />
        <Tabs label="Reader" value={as} onChange={setAs} options={[
          ...(format === 'web' ? [{ value: 'visitor' as As, label: 'Visitor' }] : []),
          { value: 'free', label: 'Free reader' },
          { value: 'paid', label: 'Paid reader' },
          { value: 'founding', label: 'Founding' },
        ]} />
      </div>
      {format === 'email' && preview?.subject && <p className="ows-sub">Subject: <strong>{preview.subject}</strong></p>}
      {error && <Failed error={error} />}
      {!error && !preview && <Loading what="the preview" />}
      {preview && (
        <iframe className={`ows-preview-frame${format === 'email' ? ' ows-preview-frame--email' : ''}`} title="Preview"
          sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={framed(preview)} />
      )}
    </Dialog>
  );
}
