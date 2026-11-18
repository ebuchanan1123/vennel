import { internalApiUrl } from '../../../../lib/development-access';
import { UnsubscribeConfirmation } from '../../../../components/unsubscribe-confirmation';

export const dynamic = 'force-dynamic';

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(token))
    return <div className="p-8">This notification link is invalid.</div>;
  const response = await fetch(
    `${internalApiUrl()}/api/notifications/unsubscribe/${encodeURIComponent(token)}`,
    { cache: 'no-store' },
  );
  if (!response.ok)
    return <div className="p-8">This notification link expired or was replaced.</div>;
  const result: unknown = await response.json();
  const name =
    typeof result === 'object' &&
    result !== null &&
    'businessName' in result &&
    typeof result.businessName === 'string'
      ? result.businessName
      : 'Your business';
  return <UnsubscribeConfirmation token={token} businessName={name} />;
}
