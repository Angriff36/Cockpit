import { PROJECT_TABS, TAB_GROUPS, type ProjectTabId } from './projectTabs';

type Props = {
  activeTab: ProjectTabId;
  onTabChange: (tabId: ProjectTabId) => void;
};

export function ProjectTabNav({ activeTab, onTabChange }: Props) {
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-2">
      {TAB_GROUPS.map(group => {
        const tabs = PROJECT_TABS.filter(t => t.group === group);
        if (tabs.length === 0) return null;
        return (
          <div key={group} className="mb-3 last:mb-0">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider font-medium text-slate-600">
              {group}
            </div>
            <div className="space-y-0.5">
              {tabs.map(tab => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange(tab.id as ProjectTabId)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition-colors ${
                      active
                        ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
