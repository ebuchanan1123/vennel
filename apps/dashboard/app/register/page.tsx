import { AccountForm } from '../../components/account-form';
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return <AccountForm mode="register" returnTo={(await searchParams).returnTo} />;
}
