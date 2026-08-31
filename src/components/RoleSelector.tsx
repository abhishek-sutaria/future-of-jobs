import RoleSelectorBody from './RoleSelectorBody';

export default function RoleSelector() {
    return (
        <div className="w-80 bg-gradient-to-b from-gray-900 to-black border-r border-gray-700/50 flex flex-col h-screen">
            {/* Header */}
            <div className="p-6 border-b border-gray-700/50">
                <h2 className="text-white font-bold text-xl mb-2">Role Selector</h2>
                <p className="text-gray-400 text-sm">Select roles to display on map</p>
            </div>

            <RoleSelectorBody />

            {/* Footer Stats */}
            <div className="p-4 border-t border-gray-700/50 bg-gray-900/50">
                <div className="text-xs text-gray-500 space-y-1">
                    <p>Tip: Select multiple roles to compare</p>
                    <p className="text-gray-600">Click map markers for details</p>
                </div>
            </div>
        </div>
    );
}
