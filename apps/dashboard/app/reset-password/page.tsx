import { AccountForm } from '../../components/account-form';
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return <AccountForm mode="reset" resetToken={token} verificationError={error} />;
}
