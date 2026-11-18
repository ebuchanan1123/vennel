import { AccountForm } from '../../components/account-form';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const { returnTo, error } = await searchParams;
  return <AccountForm mode="login" returnTo={returnTo} verificationError={error} />;
}
