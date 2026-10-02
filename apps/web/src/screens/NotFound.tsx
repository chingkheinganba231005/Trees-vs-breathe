import { Screen } from '../components/Screen';
import { useI18n } from '../i18n/context';
import { href } from '../lib/router';

export function NotFound() {
  const { t } = useI18n();
  return (
    <Screen title={t('notFound.title')}>
      <p className="mt-6">
        <a
          href={href('/')}
          className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
        >
          {t('notFound.back')}
        </a>
      </p>
    </Screen>
  );
}
