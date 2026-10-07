import { describeSources, getSubject } from "@/lib/config";
import { AskForm } from "./ask-form";

/** Server half of the page: reads the subject from env, which a client component cannot do. */
export default function Page() {
  const subject = getSubject();
  const name = subject.shortName;
  return (
    <AskForm
      subjectName={name}
      sources={describeSources(subject)}
      // Kept from the worked example: a direct lookup, a likely conflict, an education gap, a
      // probable refusal and a code question. Database-backed suggestions replace these later.
      suggestions={[
        `What has ${name} built?`,
        `Where does ${name} work now?`,
        `What did ${name} study at university?`,
        `Does ${name} have production Kubernetes experience?`,
        `Can I see ${name}'s code?`,
      ]}
    />
  );
}
