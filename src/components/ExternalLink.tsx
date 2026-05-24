import type { InputHTMLAttributes, ReactNode } from 'react';
import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import { isClickableUrl, resolveHref } from '../lib/externalLink';
import { Field, Input } from './ui';

type ExternalHrefProps = {
  href: string | null | undefined;
  children?: ReactNode;
  className?: string;
  title?: string;
};

export function ExternalHref({ href, children, className = '', title }: ExternalHrefProps) {
  const resolved = resolveHref(href);
  if (!resolved) {
    const text = children ?? href;
    if (!text) return null;
    return <span className={className}>{text}</span>;
  }

  return (
    <a
      href={resolved}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-blue-400 hover:text-blue-300 hover:underline transition-colors ${className}`}
      title={title ?? resolved}
    >
      {children ?? href}
    </a>
  );
}

export function UrlOpenButton({
  url,
  label = 'Open link',
  className = '',
}: {
  url: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const resolved = resolveHref(url);
  if (!resolved) return null;

  return (
    <a
      href={resolved}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center shrink-0 w-9 h-9 rounded border border-slate-800 bg-slate-950 text-slate-400 hover:text-blue-300 hover:border-slate-600 transition-colors ${className}`}
    >
      <ExternalLinkIcon className="w-3.5 h-3.5" />
    </a>
  );
}

type UrlInputRowProps = InputHTMLAttributes<HTMLInputElement> & {
  openLabel?: string;
};

export function UrlInputRow({ openLabel, className = '', value, ...props }: UrlInputRowProps) {
  const strValue = value == null ? '' : String(value);
  return (
    <div className="flex gap-2 items-center">
      <Input value={value} className={`flex-1 min-w-0 font-mono ${className}`} {...props} />
      <UrlOpenButton url={strValue} label={openLabel} />
    </div>
  );
}

export function UrlField({
  label,
  value,
  children,
  showPreview = true,
}: {
  label: string;
  value: string | null | undefined;
  children: ReactNode;
  showPreview?: boolean;
}) {
  const str = value?.trim() ?? '';
  return (
    <Field label={label}>
      {children}
      {showPreview && isClickableUrl(str) && (
        <ExternalHref
          href={str}
          className="mt-1.5 text-[11px] font-mono truncate block"
        />
      )}
    </Field>
  );
}
