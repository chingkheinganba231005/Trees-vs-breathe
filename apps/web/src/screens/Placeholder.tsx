import { PhaseNote } from '../components/PhaseNote';
import { Screen } from '../components/Screen';
import { useI18n } from '../i18n/context';
import type { StringKey } from '../i18n/strings';

interface Props {
  title: StringKey;
  intro: StringKey;
  phase: number;
}

/** Holds a screen's place in the navigation until its phase builds it. */
export function Placeholder({ title, intro, phase }: Props) {
  const { t } = useI18n();
  return (
    <Screen title={t(title)} intro={t(intro)}>
      <PhaseNote phase={phase} />
    </Screen>
  );
}
