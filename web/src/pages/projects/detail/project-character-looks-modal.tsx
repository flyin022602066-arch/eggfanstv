import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { ProjectCharacterLooksPanel, type CharacterLooksPanelProps } from "./project-character-looks-panel";

export function ProjectCharacterLooksModal({ onClose, ...props }: CharacterLooksPanelProps & { onClose: () => void }) {
    return <AppModal open className="project-character-looks-modal" title={`造型与版本 · ${props.asset.title}`} width={1200} footer={null} onCancel={onClose}>
        <ProjectCharacterLooksPanel key={props.asset.id} {...props} />
    </AppModal>;
}
