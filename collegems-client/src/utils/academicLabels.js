import { DEFAULT_ACADEMIC_LABELS } from "../constants/academicLabels";

export const getAcademicLabel = (key, labels = {}) => {
    return labels?.[key] || DEFAULT_ACADEMIC_LABELS[key] || key;
};