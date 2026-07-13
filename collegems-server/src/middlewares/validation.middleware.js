import { body, validationResult } from "express-validator";

const passwordPolicyMessage =
  "Password must be at least 8 characters long and include an uppercase letter, lowercase letter, number, and special character.";

export const validateRegister = [
  body("email")
    .isEmail()
    .withMessage("Invalid email address")
    .normalizeEmail(),

  body("password")
    .isStrongPassword({
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
      returnScore: false,
    })
    .withMessage(passwordPolicyMessage),

  body("name")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters")
    .escape(),

  body("role")
    .isIn(["student", "teacher", "parent"])
    .withMessage("Role must be one of: student, teacher, parent"),
  (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      const passwordError = errors.array().find(
        (error) => error.path === "password"
      );

      return res.status(400).json({
        message: passwordError
          ? passwordPolicyMessage
          : errors.array()[0].msg,
        errors: errors.array(),
      });
    }

    next();
  },
];
