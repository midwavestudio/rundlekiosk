'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  ADMIN_ACCENT,
  ADMIN_ACCENT_SUBTLE,
  ADMIN_BORDER,
  ADMIN_BORDER_STRONG,
  ADMIN_SURFACE_HIGH,
  ADMIN_SURFACE_RAISED,
  ADMIN_TEXT_FAINT,
  ADMIN_TEXT_MUTED,
  ADMIN_TEXT_PRIMARY,
  ADMIN_TINT_BG,
} from '../lib/adminTheme';

const CLC_PREFIX = '3081400185200';

const SECTIONS = [
  { id: 'daily-order', label: 'Daily order' },
  { id: 'checkouts', label: 'Checkouts' },
  { id: 'check-ins', label: 'Check-ins' },
  { id: 'clc-numbers', label: 'CLC numbers' },
  { id: 'cloudbeds', label: 'Cloudbeds' },
  { id: 'wrong-clc', label: 'Wrong CLC #' },
  { id: 'occupied', label: 'Occupied room' },
  { id: 'partial-billing', label: 'Bill partial' },
  { id: 'marks', label: 'Marks & 24h+' },
] as const;

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function TutorialTab() {
  const [activeJump, setActiveJump] = useState<string>(SECTIONS[0].id);

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto', paddingBottom: '48px' }}>
      <header style={{ marginBottom: '22px' }}>
        <p style={{
          margin: '0 0 8px',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: ADMIN_ACCENT,
        }}>
          Staff guide
        </p>
        <h2 style={{
          margin: 0,
          fontSize: 'clamp(22px, 2.6vw, 30px)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: ADMIN_TEXT_PRIMARY,
        }}>
          CLC and Cloudbeds tutorial
        </h2>
        <p style={{
          margin: '10px 0 0',
          fontSize: '15px',
          lineHeight: 1.6,
          color: ADMIN_TEXT_MUTED,
          maxWidth: '62ch',
        }}>
          How to work through arrivals each day: process checkouts, check guests into
          CLC, then confirm Cloudbeds on its own.
        </p>
      </header>

      <nav
        aria-label="Tutorial sections"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          margin: '0 -4px 22px',
          padding: '10px 4px 12px',
          background: 'linear-gradient(180deg, #1a1b1e 70%, rgba(26,27,30,0.88) 100%)',
        }}
      >
        <div style={{
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '2px',
        }}>
          {SECTIONS.map((section, index) => {
            const isActive = activeJump === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  setActiveJump(section.id);
                  scrollToSection(section.id);
                }}
                style={{
                  flexShrink: 0,
                  padding: '7px 12px',
                  borderRadius: '999px',
                  border: `1px solid ${isActive ? ADMIN_ACCENT : ADMIN_BORDER_STRONG}`,
                  background: isActive ? ADMIN_ACCENT_SUBTLE : ADMIN_SURFACE_RAISED,
                  color: isActive ? ADMIN_ACCENT : ADMIN_TEXT_MUTED,
                  fontSize: '12px',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {index + 1}. {section.label}
              </button>
            );
          })}
        </div>
      </nav>

      <QuickStartCard />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Section id="daily-order" step={1} title="Start with a set order">
          <p>
            Do the day in this order every time. Checkouts free rooms. Check-ins fill them.
            If you reverse that, CLC may already show a room as occupied.
          </p>
          <ol style={listStyle}>
            <li>Process <strong>checkouts</strong>, if there are any.</li>
            <li>Then process <strong>CLC check-ins</strong>.</li>
            <li>Go through <strong>today&apos;s arrivals</strong> at least once during the day.</li>
            <li>Confirm <strong>Cloudbeds</strong> on a separate pass.</li>
          </ol>
        </Section>

        <Section id="checkouts" step={2} title="Check guests out">
          <p>
            Open Departures and check out anyone who is leaving. This opens rooms in CLC so
            new arrivals can be checked in.
          </p>
          <p>
            Some guests forget to check out at the kiosk. If you have confirmed they have
            actually left, you can check them out in CLC yourself.
          </p>
          <p>
            If a guest stayed overnight and is still in-house, leave them. Only check out
            people who have actually departed.
          </p>
        </Section>

        <Section id="check-ins" step={3} title="Run through today&apos;s arrivals">
          <p>
            At least once a day, open the <strong>Arrivals</strong> tab and walk the list
            of today&apos;s guests. Check each person into <strong>CLC</strong> using their
            CLC number.
          </p>
        </Section>

        <Section id="clc-numbers" step={4} title="How to read CLC numbers">
          <p>
            You need the guest&apos;s CLC number to check them in on CLC. Find it on the
            Arrivals list along with their name and check-in time.
          </p>
          <p>
            Arrivals shows two kinds of numbers. Treat them differently:
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '10px',
            margin: '14px 0',
          }}>
            <NumberCard
              badge="Six digits"
              title="Add the prefix"
              body={(
                <>
                  A six-digit number needs to be added to{' '}
                  <code style={codeStyle}>{CLC_PREFIX}</code>. Type the prefix first,
                  then the six-digit number after it.
                </>
              )}
              example={`Prefix + 123456\n${CLC_PREFIX}123456`}
            />
            <NumberCard
              badge="7 digits or more"
              title="Use Copy"
              body="These already show the full number. Click Copy next to the number to put it on the clipboard, then paste it into CLC."
              example="Click Copy on Arrivals — no prefix needed."
            />
          </div>

          <Callout tone="remember" title="Quick rule">
            Six digits → add to {CLC_PREFIX}. Seven digits or more → Copy button.
          </Callout>

          <Callout tone="tip" title="When the prefix does not work">
            Once in a while a guest&apos;s CLC number is six digits in total. Adding the
            prefix will not work for those. If a six-digit number fails with the prefix,
            the number is either wrong, or it is already complete and should be entered
            without the prefix.
          </Callout>
        </Section>

        <Section id="cloudbeds" step={5} title="Confirm Cloudbeds separately">
          <p>
            After CLC is done, go through Cloudbeds as its own step. Do not try to update
            CLC and Cloudbeds at the same time for each guest — it is easier to finish one
            system, then the other.
          </p>
          <p>
            Kiosk check-ins usually create the Cloudbeds reservation automatically, but it
            does fail sometimes. Check that each guest also has a Cloudbeds reservation.
          </p>
          <p>
            If Cloudbeds is missing, look at the Arrivals row for that guest. Use the
            create / re-sync control there, or retry failed Cloudbeds check-ins from the
            Dashboard if several guests failed at once.
          </p>
        </Section>

        <Section id="wrong-clc" step={6} title="Guests often type the wrong CLC number">
          <p>
            If someone did not check in, they may have entered the wrong CLC number at
            the kiosk. This happens often.
          </p>
          <ol style={listStyle}>
            <li>Search their <strong>name</strong> in the kiosk or Arrivals list.</li>
            <li>Look at their <strong>past reservations</strong> for the correct CLC number.</li>
            <li>Use that number to check them into CLC.</li>
          </ol>
          <Callout tone="tip" title="Do not guess from today&apos;s entry">
            Today&apos;s typed number is the one most likely to be wrong. A previous stay
            is usually the reliable source.
          </Callout>
        </Section>

        <Section id="occupied" step={7} title="If CLC says doubles are not allowed">
          <p>
            When you check a guest into CLC and see{' '}
            <strong>&quot;Doubles are not allowed by contract&quot;</strong>, the room is
            already occupied by another guest in CLC.
          </p>
          <p>
            Stop and confirm the room is actually empty. Usually this means checkouts were
            not finished yet, or the guest was assigned a room that is still marked in-house
            in CLC.
          </p>
        </Section>

        <Section id="partial-billing" step={8} title="Bill General and PTI guests every 5 days">
          <p>
            <strong>General</strong> and <strong>PTI</strong> CLC guests must be partially
            billed every 5 days. This keeps the check-in score up.
          </p>
          <p>
            When 5 days have passed, click <strong>Bill Partial</strong> in CLC. Do not
            wait until they check out if they are still in-house past that point.
          </p>
        </Section>

        <Section id="marks" step={9} title="Track your progress on Arrivals">
          <p>
            Use the marks on Arrivals to keep track of who you have already handled.
            They are only visual helpers — they do not check anyone in or out.
          </p>
          <ul style={listStyle}>
            <li>
              <strong>Row marks</strong> — click a row to grey it out after you have
              processed that guest.
            </li>
            <li>
              <strong>Dot marks</strong> — tap the circle on the left for a second,
              independent check (for example CLC done vs Cloudbeds confirmed).
            </li>
          </ul>
          <p>
            Guests with a <strong>24h+</strong> badge stayed more than 24 hours. That counts
            as more than one night. Stays longer than 2 nights are rare.
          </p>
        </Section>
      </div>
    </div>
  );
}

function QuickStartCard() {
  const items = [
    'Process checkouts, then CLC check-ins.',
    'Walk today\'s Arrivals at least once.',
    'Confirm Cloudbeds on a separate pass.',
    'Bill General and PTI guests every 5 days.',
  ];
  return (
    <div style={{
      background: ADMIN_SURFACE_RAISED,
      border: `1px solid ${ADMIN_BORDER_STRONG}`,
      borderRadius: '14px',
      padding: '18px 20px',
      marginBottom: '16px',
    }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: ADMIN_TEXT_FAINT,
        marginBottom: '12px',
      }}>
        Daily checklist
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map((item, i) => (
          <li key={item} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <span style={stepBadgeStyle}>{i + 1}</span>
            <span style={{ fontSize: '14px', lineHeight: 1.5, color: ADMIN_TEXT_PRIMARY, paddingTop: '1px' }}>
              {item}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Section({
  id,
  step,
  title,
  children,
}: {
  id: string;
  step: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      style={{
        background: ADMIN_SURFACE_RAISED,
        border: `1px solid ${ADMIN_BORDER_STRONG}`,
        borderRadius: '14px',
        padding: '22px 22px 8px',
        scrollMarginTop: '64px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <span style={stepBadgeStyle}>{step}</span>
        <h3 style={{
          margin: 0,
          fontSize: '18px',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          color: ADMIN_TEXT_PRIMARY,
        }}>
          {title}
        </h3>
      </div>
      <div className="admin-tutorial-body" style={{ color: ADMIN_TEXT_MUTED, fontSize: '14.5px', lineHeight: 1.65 }}>
        {children}
      </div>
    </section>
  );
}

function NumberCard({
  badge,
  title,
  body,
  example,
}: {
  badge: string;
  title: string;
  body: ReactNode;
  example: string;
}) {
  return (
    <div style={{
      background: ADMIN_SURFACE_HIGH,
      border: `1px solid ${ADMIN_BORDER}`,
      borderRadius: '12px',
      padding: '14px 16px',
    }}>
      <div style={{
        display: 'inline-block',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: ADMIN_ACCENT,
        background: ADMIN_TINT_BG,
        border: `1px solid rgba(184,115,51,0.35)`,
        borderRadius: '999px',
        padding: '3px 8px',
        marginBottom: '8px',
      }}>
        {badge}
      </div>
      <div style={{ fontSize: '15px', fontWeight: 700, color: ADMIN_TEXT_PRIMARY, marginBottom: '6px' }}>
        {title}
      </div>
      <div style={{ fontSize: '13.5px', lineHeight: 1.55, color: ADMIN_TEXT_MUTED, marginBottom: '10px' }}>
        {body}
      </div>
      <pre style={{
        margin: 0,
        padding: '10px 12px',
        background: '#141517',
        borderRadius: '8px',
        fontSize: '12px',
        lineHeight: 1.5,
        color: '#e8c49e',
        whiteSpace: 'pre-wrap',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      }}>
        {example}
      </pre>
    </div>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: 'tip' | 'remember';
  title: string;
  children: ReactNode;
}) {
  const isTip = tone === 'tip';
  return (
    <div style={{
      margin: '14px 0 16px',
      padding: '12px 14px',
      borderRadius: '10px',
      border: `1px solid ${isTip ? 'rgba(184,115,51,0.35)' : 'rgba(96,165,250,0.28)'}`,
      background: isTip ? ADMIN_TINT_BG : 'rgba(96,165,250,0.08)',
    }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: isTip ? ADMIN_ACCENT : '#93c5fd',
        marginBottom: '4px',
      }}>
        {title}
      </div>
      <div style={{ fontSize: '13.5px', lineHeight: 1.55, color: ADMIN_TEXT_MUTED }}>
        {children}
      </div>
    </div>
  );
}

const listStyle: CSSProperties = {
  margin: '10px 0 14px',
  paddingLeft: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '12.5px',
  color: '#e8c49e',
  background: '#141517',
  padding: '1px 6px',
  borderRadius: '4px',
};

const stepBadgeStyle: CSSProperties = {
  width: '22px',
  height: '22px',
  borderRadius: '50%',
  background: ADMIN_ACCENT,
  color: '#fff',
  fontSize: '12px',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  lineHeight: 1,
};
