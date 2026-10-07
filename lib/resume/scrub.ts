/**
 * Removes contact details from extracted resume text before the model or the guard sees it.
 *
 * Removal happens on the source, not the output: the guard checks the model's text against this
 * scrubbed version, so even a model that tried to copy a phone number would be dropped for citing
 * digits the source no longer contains.
 *
 * Covers email addresses and phone numbers. Street addresses are not detected; a resume that lists
 * one should be uploaded without it.
 */

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
/** A run of digits with common phone separators, optionally led by "+". Filtered further below. */
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]{6,}\d/g;

/** Nine or more digits, and not just a list of years such as "2015 2016 2017". */
function looksLikePhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return false;
  const groups = candidate.match(/\d+/g) ?? [];
  return !groups.every((group) => /^(19|20)\d{2}$/.test(group));
}

export interface ScrubResult {
  text: string;
  removed: { emails: number; phones: number };
}

export function scrubContactDetails(text: string): ScrubResult {
  let emails = 0;
  let phones = 0;
  const withoutEmails = text.replace(EMAIL, () => {
    emails++;
    return " ";
  });
  const withoutPhones = withoutEmails.replace(PHONE_CANDIDATE, (candidate) => {
    if (!looksLikePhone(candidate)) return candidate;
    phones++;
    return " ";
  });
  return { text: withoutPhones, removed: { emails, phones } };
}
