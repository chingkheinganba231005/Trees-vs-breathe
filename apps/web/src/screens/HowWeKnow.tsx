import { PhaseNote } from '../components/PhaseNote';
import { Screen } from '../components/Screen';
import { leftOutKeys } from '../content/leftOut';
import { useI18n } from '../i18n/context';

export function HowWeKnow() {
  const { t } = useI18n();
  return (
    <Screen title={t('howWeKnow.title')} intro={t('howWeKnow.intro')}>
      <PhaseNote phase={5} />
      <h2 className="mt-10 text-xl font-bold">{t('howWeKnow.leftOutTitle')}</h2>
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
        {leftOutKeys.map((key) => (
          <li key={key} className="px-4 py-3 leading-snug">
            {t(key)}
          </li>
        ))}
      </ul>
    </Screen>
  );
}
