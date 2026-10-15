export interface NumericRangeInputTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface NumericRangeFeedbackTarget {
  textContent: string | null;
  hidden: boolean;
}

export interface NumericRangeValidationOptions {
  integer?: boolean;
  allowEmpty?: boolean;
}

/** Validate a bounded numeric setting and keep its accessible error state in sync. */
export function validateNumericRangeInput(
  rawValue: string,
  min: number,
  max: number,
  input: NumericRangeInputTarget,
  feedback: NumericRangeFeedbackTarget,
  options: NumericRangeValidationOptions = {}
): number | null {
  const value = rawValue.trim();
  if (!value && options.allowEmpty) {
    input.removeAttribute("aria-invalid");
    feedback.textContent = "";
    feedback.hidden = true;
    return null;
  }

  const number = Number(value);
  const valid = value.length > 0
    && Number.isFinite(number)
    && number >= min
    && number <= max
    && (!options.integer || Number.isInteger(number));

  if (!valid) {
    input.setAttribute("aria-invalid", "true");
    feedback.textContent = "请输入 " + min + "–" + max + " 范围内的"
      + (options.integer ? "整数" : "数值") + "；当前值尚未保存。";
    feedback.hidden = false;
    return null;
  }

  input.removeAttribute("aria-invalid");
  feedback.textContent = "";
  feedback.hidden = true;
  return number;
}
