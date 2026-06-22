export default function Loading() {
  return (
    <div className="page-transition pt-16 md:pt-[72px]">
      <div className="container-brand py-12 md:py-16">
        <div className="skeleton h-8 w-48 mb-4" />
        <div className="skeleton h-4 w-24 mb-12" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton aspect-[3/4] mb-4" />
              <div className="skeleton h-3 w-24 mb-2" />
              <div className="skeleton h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
