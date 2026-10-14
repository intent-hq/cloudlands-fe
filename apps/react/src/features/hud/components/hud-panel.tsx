import type { ReactNode } from 'react';
import styles from './hud-panel.module.css';

interface HudPanelProps {
  title: string;
  fill?: boolean;
  meta?: ReactNode;
  children: ReactNode;
}

export function HudPanel({ title, fill = false, meta, children }: HudPanelProps) {
  return (
    <section className={`${styles['hud-panel']}${fill ? ` ${styles['hud-panel-fill']}` : ''}`}>
      <header className={styles['hud-panel-header']}>
        <span className={styles['hud-panel-title']}>{title}</span>
        <span className={styles['hud-panel-rule']}></span>
        {meta}
      </header>
      {children}
    </section>
  );
}
