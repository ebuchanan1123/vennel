import { AccountForm } from '../../components/account-form';
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const { error, returnTo } = await searchParams;
  return <AccountForm mode="verify" verificationError={error} returnTo={returnTo} />;
}
