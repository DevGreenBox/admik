export default function Loading() {
  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div className="skeleton aspect-[3/4]" />
          <div className="space-y-6">
            <div className="skeleton h-8 w-48" />
            <div className="skeleton h-6 w-32" />
            <div className="skeleton h-20 w-full" />
            <div className="skeleton h-12 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
