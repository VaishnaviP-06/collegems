import { hashPassword, comparePassword } from "../utils/hashPassword.js";
import User from "../models/User.model.js";
import StudentTimelineEvent from "../models/StudentTimelineEvent.model.js";
import { logAction } from "../utils/auditService.js";
import { getPaginatedData } from "../utils/pagination.util.js";
import { revokeAllSessions } from "../utils/session.service.js";
import calculateProfileCompletion from "../utils/profileCompletion.js";
import Attendance from "../models/Attendance.model.js";
import Results from "../models/Results.model.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { checkPotentialDuplicates } from "../services/duplicateDetection.service.js";
import { secureResumesDir } from "../middlewares/upload.middleware.js";
const normalizeSettings = (settings) => {
  const safeSettings = settings || {};
  return {
    preferences: {
      language: "en",
      timezone: "UTC",
      digestFrequency: "weekly",
      ...(safeSettings.preferences || {}),
    },
    notifications: {
      email: true,
      sms: false,
      inApp: true,
      ...(safeSettings.notifications || {}),
    },
  };
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let profileCompletion = null;
    if (user.role === "student") {
      profileCompletion = calculateProfileCompletion(user);
    }

    res.json({
      ...user.toObject(),
      profileCompletion,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateMe = async (req, res) => {
  try {
    const { name, email, phone, department, teacherId, bio, officeHours } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
   if (
     user.academicRecordLocked &&
     (
       req.body.studentId !== undefined ||
       req.body.semester !== undefined ||
       req.body.course !== undefined
    )
  ) {
    return res.status(403).json({
      message: "Academic record is locked after result publication",
    });
  }

    if (email && email !== user.email) {
      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(400).json({ message: "Email already in use" });
      }
      user.email = email;
    }

    if (name) user.name = name;
    if (phone !== undefined) user.phone = phone;
    
    // Teacher specific profile updates
    if (user.role === 'teacher') {
      if (department !== undefined) user.department = department;
      if (teacherId !== undefined) user.teacherId = teacherId;
      if (bio !== undefined) user.bio = bio;
      if (officeHours !== undefined) user.officeHours = officeHours;
    }

    user._updatedBy = req.user.id;
    await user.save();

    const safeUser = user.toObject();
    delete safeUser.password;

    res.json(safeUser);

    // Log the update
    await logAction(req.user.id, "UPDATE_PROFILE", "User", req.user.id, { updatedFields: req.body });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current and new passwords are required" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const match = await comparePassword(currentPassword, user.password);
    if (!match) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    user.password = await hashPassword(newPassword, 8);
    user._updatedBy = req.user.id;
    await user.save();

    await revokeAllSessions(req.user.id);
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.json({ message: "Password updated successfully" });

    // Log password update
    await logAction(req.user.id, "UPDATE_PASSWORD", "User", req.user.id, {});
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("settings");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(normalizeSettings(user.settings));
  } catch (error) {
    console.error("Error fetching preferences:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const updatePreferences = async (req, res) => {
  try {
    const { preferences, notifications } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const current = normalizeSettings(user.settings);

    user.settings = {
      preferences: {
        ...current.preferences,
        ...(preferences || {}),
      },
      notifications: {
        ...current.notifications,
        ...(notifications || {}),
      },
    };

    user._updatedBy = req.user.id;
    await user.save();

    res.json(user.settings);
  } catch (error) {
    console.error("Error updating preferences:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getStudentProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await User.findOne({
      _id: id,
      role: "student",
    }).select("-password");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.status(200).json(student);
  } catch (error) {
    console.error("Error fetching student profile:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getStudents = async (req, res) => {
  try {
    const result = await getPaginatedData(User, req.query, {
      baseFilter: { role: "student" },
      searchFields: ["name", "email", "studentId"],
      select: "name email role studentId course semester department tags joinedAt lastUpdated",
      defaultSort: { name: 1 },
      defaultLimit: 20,
      useTextSearch: true,
    });

    res.json(result);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ message: "Server error fetching students" });
  }
};

export const uploadResumeFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Please upload a PDF file" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Resumes are stored outside the public/static file tree and are only
    // ever retrieved through the authenticated GET /me/resume route below,
    // so we only need to remember the on-disk filename, not a public URL.
    user.resumeUrl = req.file.filename;
    user._updatedBy = req.user.id;
    await user.save();

    res.json({
      success: true,
      message: "Resume uploaded successfully",
    });
  } catch (error) {
    console.error("Error uploading resume:", error);
    res.status(500).json({ message: "Server error uploading resume" });
  }
};

export const downloadResumeFile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.resumeUrl) {
      return res.status(404).json({ message: "No resume on file" });
    }

    const filePath = path.join(secureResumesDir, user.resumeUrl);
    if (!filePath.startsWith(secureResumesDir) || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Resume file not found" });
    }

    res.download(filePath, "resume.pdf");
  } catch (error) {
    console.error("Error downloading resume:", error);
    res.status(500).json({ message: "Server error downloading resume" });
  }
};

export const getStudentSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await User.findOne({ _id: id, role: "student" }).select("name email studentId course semester joinedAt");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // Attendance Calculation
    const totalAttendance = await Attendance.countDocuments({ student: id });
    const presentAttendance = await Attendance.countDocuments({ student: id, status: "present" });
    const attendancePercentage = totalAttendance ? Math.round((presentAttendance / totalAttendance) * 100) : null;

    // Results Summary (calculate average marks)
    const results = await Results.find({ studentId: id, status: "published" });
    let averageMarks = null;
    if (results.length > 0) {
      const numericResults = results.filter(r => r.marks && !isNaN(parseFloat(r.marks)));
      if (numericResults.length > 0) {
        const totalMarks = numericResults.reduce((acc, curr) => acc + parseFloat(curr.marks), 0);
        averageMarks = Math.round(totalMarks / numericResults.length);
      }
    }

    res.json({
      student,
      attendancePercentage,
      averageMarks,
      totalExams: results.length
    });
  } catch (error) {
    console.error("Error fetching student summary:", error);
    res.status(500).json({ message: "Server error fetching summary" });
  }
};

export const bulkAssignTags = async (req, res) => {
  try {
    const { userIds, tags } = req.body;

    if (!userIds || !Array.isArray(userIds) || !tags || !Array.isArray(tags)) {
      return res.status(400).json({ message: "userIds and tags must be arrays" });
    }

    if (userIds.length === 0) {
      return res.status(400).json({ message: "userIds array cannot be empty" });
    }

    // Process tags: type check, trim, remove empty, check length
    const processedTags = [];
    for (const t of tags) {
      if (typeof t !== "string") {
        return res.status(400).json({ message: "All tags must be strings" });
      }
      const trimmed = t.trim();
      if (!trimmed) continue;
      if (trimmed.length > 50) {
        return res.status(400).json({ message: `Tag "${trimmed.substring(0, 20)}..." exceeds the 50 character limit` });
      }
      processedTags.push(trimmed);
    }

    // Deduplicate
    const uniqueTags = [...new Set(processedTags)];

    if (uniqueTags.length === 0) {
      return res.status(400).json({ message: "No valid tags provided" });
    }

    const result = await User.updateMany(
      { _id: { $in: userIds }, role: "student" },
      { $addToSet: { tags: { $each: uniqueTags } } }
    );

    // Audit logging
    await logAction(req.user.id, "BULK_ASSIGN_TAGS", "User", null, { userIds, tags: uniqueTags });

    res.json({ 
      success: true,
      message: "Tags assigned successfully", 
      matchedCount: result.matchedCount, 
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    console.error("Error in bulkAssignTags:", error);
    res.status(500).json({ message: "Server error assigning tags" });
  }
};

export const unlockAcademicRecord = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { academicRecordLocked: false },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.json({
      message: "Academic record unlocked successfully",
      user,
    });
  } catch (error) {
    console.error("Unlock academic record error:", error);
    res.status(500).json({
      message: "Failed to unlock academic record",
    });
  }
};
export const createUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      studentId,
      teacherId,
      department,
      departmentCode,
      semester,
      course,
      childStudentId,
      phone,
      dob,
    } = req.body || {};

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields required" });
    }

    const ALLOWED_ROLES = ["student", "teacher", "parent", "hod", "admin"];
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ message: "Invalid user role" });
    }

    const COLLEGE_DOMAIN = process.env.COLLEGE_DOMAIN || "";
    const emailNorm = email.trim().toLowerCase();

    // Check institutional email domain for privileged roles
    if (role === "hod" || role === "admin") {
      if (COLLEGE_DOMAIN && !emailNorm.endsWith(`@${COLLEGE_DOMAIN.toLowerCase()}`)) {
        return res.status(400).json({
          message: `Email must belong to domain ${COLLEGE_DOMAIN}`,
        });
      }
    }

    // Role-specific validation
    let userData = {
      name,
      email: emailNorm,
      password: await hashPassword(password, 8),
      role,
      phone,
      dob,
    };

    if (role === "student") {
      if (!studentId) {
        return res.status(400).json({ message: "Student ID required" });
      }
      if (!semester || !course) {
        return res.status(400).json({ message: "Semester and course required for student" });
      }
      userData = { ...userData, studentId, semester, course };
    }

    else if (role === "teacher") {
      if (!teacherId) {
        return res.status(400).json({ message: "Teacher ID required" });
      }
      if (!department) {
        return res.status(400).json({ message: "Department required" });
      }
      userData = { ...userData, teacherId, department };
    }

    else if (role === "parent") {
      if (!childStudentId) {
        return res.status(400).json({ message: "Child's Student ID required" });
      }
      const student = await User.findOne({ studentId: childStudentId, role: "student" });
      if (!student) {
        return res.status(404).json({ message: "Student with this ID does not exist" });
      }
      userData = { ...userData, childId: student._id };
    }

    else if (role === "hod") {
      if (!departmentCode) {
        return res.status(400).json({ message: "Department code required for HOD" });
      }
      const VALID_DEPARTMENT_CODES = ["CSE", "ECE", "ME", "EE", "CE", "MATH", "PHY", "BUS", "CS", "IT"];
      if (!VALID_DEPARTMENT_CODES.includes(departmentCode.toUpperCase())) {
        const existsInDB = await User.exists({ departmentCode: departmentCode.toUpperCase() });
        if (!existsInDB) {
          return res.status(400).json({ message: "Invalid or unauthorized department code" });
        }
      }
      userData = { ...userData, departmentCode: departmentCode.toUpperCase() };
    }

    // Check existing user strictly by email
    const exists = await User.findOne({ email: emailNorm });
    if (exists) {
      return res.status(400).json({ message: "User already exists with this email" });
    }

    const user = await User.create(userData);

    res.status(201).json({
      message: "User created successfully",
      user: { id: user._id, name: user.name, role: user.role, email: user.email },
    });

    // Log action
    await logAction(req.user.id, "ADMIN_CREATE_USER", "User", user._id, {
      role: user.role,
      email: user.email,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ message: "Server error creating user" });
  }
};

export const createTeacher = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      teacherId,
      department,
      phone,
      dob,
      bio,
      overrideDuplicates,
    } = req.body || {};

    if (!name || !email || !password || !teacherId || !department) {
      return res.status(400).json({
        message:
          "Name, email, password, teacher ID and department are required",
      });
    }

    const existing = await User.findOne({
      email: email.trim().toLowerCase(),
    });

    if (existing) {
      return res.status(400).json({
        message: "User already exists with this email",
      });
    }

    let duplicates = [];

    if (!overrideDuplicates) {
      duplicates = await checkPotentialDuplicates({
        name,
        email,
        teacherId,
        department,
        phone,
        dob,
        role: "teacher",
      });

      if (duplicates.length > 0) {
        return res.status(409).json({
          isDuplicateWarning: true,
          matches: duplicates,
        });
      }
    }

    const teacher = await User.create({
      name,
      email: email.trim().toLowerCase(),
      password: await hashPassword(password, 8),
      role: "teacher",
      teacherId,
      department,
      phone,
      dob,
      bio,
    });

    await logAction(
      req.user.id,
      "CREATE_TEACHER",
      "User",
      teacher._id,
      {}
    );

    res.status(201).json({
      message: "Teacher created successfully",
      teacher,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({  
      message: "Server error",
    });
  }
};
