/**
 * Briques d'interface reprises du canvas « Fusion Sauvegardes », comme
 * `src/ui/kit.tsx` côté mobile — en éléments HTML plutôt qu'en vues natives.
 */
'use client';

import { useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';

import type { ErrorView } from '@core/errors';

import s from './kit.module.css';

export function Eyebrow({ children, tone }: { children: ReactNode; tone?: 'accent' | 'faint' }) {
  return <p className={`${s.eyebrow} ${tone ? s[tone] : ''}`}>{children}</p>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`${s.card} ${className}`}>{children}</div>;
}

interface ButtonProps {
  label: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

/** `submit` dans un formulaire, pour que la touche Entrée le valide. */
export function PrimaryButton({ label, onClick, disabled, type = 'button' }: ButtonProps & { type?: 'button' | 'submit' }) {
  return <button type={type} className={s.primary} onClick={onClick} disabled={disabled}>{label}</button>;
}

/** Champ de formulaire avec son libellé. */
export function TextField({ label, hint, ...input }: {
  label: string;
  hint?: string;
} & Pick<InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'autoComplete' | 'required' | 'minLength' | 'disabled' | 'name' | 'inputMode' | 'autoFocus'>) {
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <input className={s.input} {...input} />
      {hint && <span className={s.fieldHint}>{hint}</span>}
    </label>
  );
}

export function SecondaryButton({ label, onClick, disabled }: ButtonProps) {
  return <button type="button" className={s.secondary} onClick={onClick} disabled={disabled}>{label}</button>;
}

/** Action irréversible (« Supprimer définitivement »). `submit` dans un formulaire. */
export function DangerButton({ label, onClick, disabled, type = 'button' }: ButtonProps & { type?: 'button' | 'submit' }) {
  return <button type={type} className={s.danger} onClick={onClick} disabled={disabled}>{label}</button>;
}

export function DashedButton({ label, onClick, disabled }: ButtonProps) {
  return <button type="button" className={s.dashed} onClick={onClick} disabled={disabled}>{label}</button>;
}

/** Lien souligné : « Terminer sans enregistrer ». */
export function TextButton({ label, onClick, disabled }: ButtonProps) {
  return <button type="button" className={s.text} onClick={onClick} disabled={disabled}>{label}</button>;
}

/** Séparateur « — + — » entre les deux fichiers. */
export function PlusRule() {
  return (
    <div className={s.plusRule} aria-hidden>
      <span className={s.rule} />
      <span className={s.plus}>+</span>
      <span className={s.rule} />
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Segment à pastille : choix du traitement des doublons, onglets. */
export function Segmented<T extends string>({ options, value, onChange, variant = 'compact', disabled, label }: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: 'compact' | 'tabs';
  disabled?: boolean;
  label: string;
}) {
  const tabs = variant === 'tabs';
  return (
    <div role={tabs ? 'tablist' : 'radiogroup'} aria-label={label} className={tabs ? s.tabTrack : s.segmentTrack}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={tabs ? 'tab' : 'radio'}
            aria-selected={tabs ? active : undefined}
            aria-checked={tabs ? undefined : active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`${tabs ? s.tabItem : s.segmentItem} ${active ? s.active : ''}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Barre d'avancement de la fusion. */
export function ProgressBar({ ratio }: { ratio: number }) {
  const value = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div className={s.progressTrack} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={s.progressFill} style={{ width: `${value}%` } as CSSProperties} />
    </div>
  );
}

/** Indicateur d'activité, à la place de l'`ActivityIndicator` natif. */
export function Spinner() {
  return <span className={s.spinner} aria-hidden />;
}

/**
 * Encart d'erreur : ce qui s'est passé, puis quoi faire. Le message technique
 * est replié derrière « Détail technique », et déjà écrit en entier dans la
 * console du navigateur.
 */
export function ErrorNotice({ error, onDismiss }: { error: ErrorView; onDismiss?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={s.notice} role="alert">
      <div className={s.noticeHead}>
        <p className={s.noticeTitle}>{error.title}</p>
        {onDismiss && (
          <button type="button" className={s.noticeClose} aria-label="Fermer le message d’erreur" onClick={onDismiss}>
            ✕
          </button>
        )}
      </div>
      <p className={s.noticeMessage}>{error.message}</p>
      {error.hint && <p className={s.noticeHint}>{error.hint}</p>}
      <button type="button" className={s.noticeToggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Masquer le détail' : 'Détail technique'}
      </button>
      {open && <p className={s.noticeTechnical}>{error.technical}</p>}
    </div>
  );
}
