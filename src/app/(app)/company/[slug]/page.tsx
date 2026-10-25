import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/auth/guard";
import { hubCategoryBySlug, listSections } from "@/server/services/workplace";
import { HubSections } from "@/components/app/workplace/hub-sections";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await hubCategoryBySlug((await params).slug);
  return { title: c ? `${c.title} · Company Hub` : "Company Hub" };
}

export default async function HubCategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePageUser();
  const category = await hubCategoryBySlug((await params).slug);
  if (!category) notFound();
  const sections = await listSections({ categoryId: category.id });
  return (
    <HubSections
      label={category.title}
      sections={sections}
      before={category.description && <p className="-mt-1 text-[14px] text-muted">{category.description}</p>}
      empty={{ title: `${category.title} is being written`, description: "Content for this tab hasn't been added yet." }}
    />
  );
}
