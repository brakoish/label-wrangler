/**
 * An on/off setting that takes effect at once ("Shrink long text to fit").
 * 44×24 with a 44px tall touch area; while pressed the knob stretches about
 * 12% toward where it will go, then slides (globals.css .switch). A choice
 * someone confirms ("Print anyway") stays a tick box, not a switch.
 */
export function Switch({ checked, onChange, labelledBy, label, disabled }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** The id of the visible words that name it. */
  labelledBy?: string;
  /** Its name when no visible words do. */
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="switch disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
