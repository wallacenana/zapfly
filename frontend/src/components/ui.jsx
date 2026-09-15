import React from 'react';

export function Button({ as: Element = 'button', variant = 'primary', size = 'md', className = '', children, ...props }) {
  return (
    <Element className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()} {...props}>
      {children}
    </Element>
  );
}

export function Input({ label, helper, error, className = '', ...props }) {
  return (
    <label className={`ui-field ${className}`.trim()}>
      {label ? <span className="ui-label">{label}</span> : null}
      <input className={`ui-input${error ? ' ui-input--error' : ''}`} {...props} />
      {error ? <span className="ui-field-message ui-field-message--error">{error}</span> : helper ? <span className="ui-field-message">{helper}</span> : null}
    </label>
  );
}

export function Text({ as: Element = 'p', variant = 'body', className = '', children, ...props }) {
  return <Element className={`ui-text ui-text--${variant} ${className}`.trim()} {...props}>{children}</Element>;
}

export function Heading({ as: Element = 'h2', level = 2, className = '', children, ...props }) {
  const Tag = Element || `h${level}`;
  return <Tag className={`ui-heading ui-heading--${level} ${className}`.trim()} {...props}>{children}</Tag>;
}

export function Switch({ checked = false, onChange, label, disabled = false, className = '' }) {
  return (
    <label className={`ui-switch ${disabled ? 'is-disabled' : ''} ${className}`.trim()}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="ui-switch__track" aria-hidden="true"><span className="ui-switch__thumb" /></span>
      {label ? <span className="ui-switch__label">{label}</span> : null}
    </label>
  );
}

export function Tabs({ items = [], value, onChange, className = '' }) {
  return (
    <div className={`ui-tabs ${className}`.trim()} role="tablist">
      {items.map(item => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={`ui-tab${value === item.value ? ' is-active' : ''}`}
          onClick={() => onChange?.(item.value)}
        >
          {item.icon ? <item.icon size={16} aria-hidden="true" /> : null}
          {item.label}
        </button>
      ))}
    </div>
  );
}
