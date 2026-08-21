import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";

/**
 * The filter inputs the applications list and the review queue both use. Three separate copies of
 * these existed before, which is how the two screens' filters drifted apart.
 *
 * A control can be shown unavailable with a reason. An unavailable one takes no value and no
 * callback at all — the props are a union, so a filter that cannot be used cannot be wired to
 * state, and cannot quietly drop rows.
 */

type Unavailable = {
  label: string;
  /** Why the filter cannot be used, in one short line. */
  unavailable: string;
};

/** One text box that narrows a column. */
export function FilterInput(
  props:
    | { label: string; value: string; onChange: (value: string) => void; unavailable?: undefined }
    | Unavailable,
) {
  if (props.unavailable !== undefined) {
    return <Off label={props.label} reason={props.unavailable} />;
  }
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{props.label}</Label>
      <Input
        className="mt-1"
        value={props.value}
        placeholder="Search…"
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}

/** A low and a high bound on one number. Either side may be left empty. */
export function FilterRange(
  props:
    | {
        label: string;
        min: string;
        max: string;
        onMinChange: (value: string) => void;
        onMaxChange: (value: string) => void;
        unavailable?: undefined;
      }
    | Unavailable,
) {
  if (props.unavailable !== undefined) {
    return <Off label={props.label} reason={props.unavailable} range />;
  }
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{props.label}</Label>
      <div className="mt-1 flex gap-1.5">
        <Input
          type="number"
          value={props.min}
          placeholder="Min"
          onChange={(event) => props.onMinChange(event.target.value)}
        />
        <Input
          type="number"
          value={props.max}
          placeholder="Max"
          onChange={(event) => props.onMaxChange(event.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * A filter a reviewer can see but not use. It keeps no state of its own — there is nothing to
 * clear, and nothing that could reach the row matching.
 */
function Off({ label, reason, range }: { label: string; reason: string; range?: boolean }) {
  return (
    <div aria-disabled className="opacity-60">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 flex gap-1.5">
        <Input disabled value="" placeholder={range ? "Min" : "Search…"} />
        {range && <Input disabled value="" placeholder="Max" />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}
