'use client';

import { useState, type CSSProperties, type MouseEvent } from 'react';

function digitCount(value: string): number {
  return value.replace(/\D/g, '').length;
}

type ClcNumberDisplayProps = {
  value: string;
  color?: string;
  /** Ellipsize long values in tight table cells. */
  truncate?: boolean;
  style?: CSSProperties;
};

/** Renders a CLC number; values with more than 6 digits get a one-click copy control. */
export function ClcNumberDisplay({
  value,
  color = '#374151',
  truncate = false,
  style,
}: ClcNumberDisplayProps) {
  const [copied, setCopied] = useState(false);
  const showCopy = Boolean(value) && value !== '-' && digitCount(value) > 6;

  async function handleCopy(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (insecure context / denied permission).
    }
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        maxWidth: '100%',
        ...style,
      }}
    >
      <span
        title={value}
        style={{
          fontSize: '14px',
          color,
          ...(truncate
            ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }
            : { wordBreak: 'break-all' }),
        }}
      >
        {value}
      </span>
      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy full CLC number'}
          aria-label={copied ? 'Copied' : 'Copy full CLC number'}
          style={{
            flexShrink: 0,
            border: '1px solid',
            borderColor: copied ? '#86efac' : '#e5e7eb',
            background: copied ? '#dcfce7' : '#f9fafb',
            color: copied ? '#15803d' : '#6b7280',
            borderRadius: 4,
            padding: '1px 5px',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            lineHeight: 1.3,
            letterSpacing: '0.02em',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </span>
  );
}
