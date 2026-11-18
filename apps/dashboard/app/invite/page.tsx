import { InvitationAcceptance } from '../../components/invitation-acceptance';
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return <div className="p-8">This invitation link is invalid.</div>;
  return <InvitationAcceptance token={token} />;
}
