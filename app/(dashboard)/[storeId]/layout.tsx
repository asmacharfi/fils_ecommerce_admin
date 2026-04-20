import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs';

import Navbar from '@/components/navbar'
import AdminAIDrawer from '@/components/admin-ai-drawer'
import prismadb from '@/lib/prismadb';

export default async function DashboardLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: { storeId: string }
}) {
  const { userId } = auth();

  if (!userId) {
    redirect('/sign-in');
  }

  const stores = await prismadb.store.findMany({
    where: {
      userId,
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const store = stores.find((item) => item.id === params.storeId);

  if (!store) {
    redirect('/');
  };

  return (
    <>
      <Navbar stores={stores} />
      <AdminAIDrawer storeId={params.storeId} />
      {children}
    </>
  );
};
